use crate::model::{
    ExecutionEvidence, ExpectedExecution, RelayAcknowledgement, TerminalExecutionState,
};
use crate::rpc::{normalize_address, parse_hex_u128, parse_hex_u64, BscRpcClient, RpcLog};
use anyhow::{bail, Context, Result};
use chrono::{DateTime, Utc};
use sha3::{Digest, Keccak256};
use std::time::{Duration, Instant};

const ARBITRAGE_EVENT_SIGNATURE: &str =
    "ArbitrageExecuted(bytes32,address,address,uint256,uint256)";

pub fn keccak_hex(bytes: &[u8]) -> String {
    format!("0x{}", hex::encode(Keccak256::digest(bytes)))
}

pub fn raw_transaction_hash(raw_transaction: &str) -> Result<String> {
    let bytes = hex::decode(raw_transaction.trim_start_matches("0x"))
        .context("raw transaction is not valid hex")?;
    if bytes.is_empty() {
        bail!("raw transaction is empty");
    }
    Ok(keccak_hex(&bytes))
}

pub fn hash_opportunity<T: serde::Serialize>(value: &T) -> Result<String> {
    Ok(keccak_hex(&serde_json::to_vec(value)?))
}

fn topic_address(address: &str) -> Result<String> {
    let normalized = normalize_address(address)?;
    Ok(format!("0x{:0>64}", &normalized[2..]))
}

fn matching_arbitrage_profit(logs: &[RpcLog], expected: &ExpectedExecution) -> Result<Option<u128>> {
    let event_topic = keccak_hex(ARBITRAGE_EVENT_SIGNATURE.as_bytes());
    let executor = normalize_address(&expected.executor)?;
    let execution_id = expected.execution_id_hash.to_ascii_lowercase();
    if execution_id.len() != 66 || !execution_id.starts_with("0x") {
        bail!("executionIdHash must be 32 bytes");
    }
    let token_topic = topic_address(&expected.profit_token)?;
    let recipient_topic = topic_address(&expected.profit_recipient)?;
    for log in logs {
        if normalize_address(&log.address)? != executor || log.topics.len() != 4 {
            continue;
        }
        if log.topics[0].to_ascii_lowercase() != event_topic
            || log.topics[1].to_ascii_lowercase() != execution_id
            || log.topics[2].to_ascii_lowercase() != token_topic
            || log.topics[3].to_ascii_lowercase() != recipient_topic
        {
            continue;
        }
        let data = log.data.trim_start_matches("0x");
        if data.len() != 128 {
            bail!("ArbitrageExecuted event has invalid data length");
        }
        return Ok(Some(parse_hex_u128(&format!("0x{}", &data[64..]))?));
    }
    Ok(None)
}

#[allow(clippy::too_many_arguments)]
pub async fn reconcile_finalized_execution(
    rpc: &BscRpcClient,
    execution_id: String,
    tx_hash: String,
    opportunity_hash: String,
    expected: ExpectedExecution,
    acknowledgements: Vec<RelayAcknowledgement>,
    submitted_at: Instant,
    expires_at: DateTime<Utc>,
) -> ExecutionEvidence {
    let base = |terminal_state, error| ExecutionEvidence {
        schema_version: 1,
        execution_id: execution_id.clone(),
        environment: "LIVE".to_string(),
        terminal_state,
        tx_hash: Some(tx_hash.clone()),
        opportunity_hash: opportunity_hash.clone(),
        calldata_hash: expected.calldata_hash.clone(),
        included_block_number: None,
        included_block_hash: None,
        finalized_block_number: None,
        finalized_block_hash: None,
        before_balance_base_units: None,
        after_balance_base_units: None,
        realized_profit_base_units: None,
        observed_inclusion_ms: None,
        observed_finality_ms: None,
        relay_acknowledgements: acknowledgements.clone(),
        error,
        recorded_at: Utc::now(),
    };

    loop {
        if Utc::now() >= expires_at {
            return base(
                TerminalExecutionState::ExpiredNotIncluded,
                Some("transaction was not included before the signed expiry".to_string()),
            );
        }
        match rpc.receipt(&tx_hash).await {
            Ok(Some(receipt)) => {
                let inclusion_ms = submitted_at.elapsed().as_millis() as u64;
                let included_block = match parse_hex_u64(&receipt.block_number) {
                    Ok(value) => value,
                    Err(error) => {
                        return base(TerminalExecutionState::EvidenceMismatch, Some(error.to_string()))
                    }
                };
                if receipt.status != "0x1" {
                    let mut evidence = base(
                        TerminalExecutionState::Reverted,
                        Some("execution receipt status is not 1".to_string()),
                    );
                    evidence.included_block_number = Some(included_block);
                    evidence.included_block_hash = Some(receipt.block_hash);
                    evidence.observed_inclusion_ms = Some(inclusion_ms);
                    return evidence;
                }

                let transaction = match rpc.transaction(&tx_hash).await {
                    Ok(Some(value)) => value,
                    Ok(None) => {
                        return base(
                            TerminalExecutionState::EvidenceMismatch,
                            Some("receipt exists but transaction is unavailable".to_string()),
                        )
                    }
                    Err(error) => {
                        return base(TerminalExecutionState::EvidenceMismatch, Some(error.to_string()))
                    }
                };
                let tx_to = transaction.to.as_deref().unwrap_or_default();
                if normalize_address(&transaction.from).ok()
                    != normalize_address(&expected.sender).ok()
                    || normalize_address(tx_to).ok() != normalize_address(&expected.executor).ok()
                    || keccak_hex(
                        &hex::decode(transaction.input.trim_start_matches("0x"))
                            .unwrap_or_default(),
                    ) != expected.calldata_hash.to_ascii_lowercase()
                {
                    return base(
                        TerminalExecutionState::EvidenceMismatch,
                        Some("sender, executor, or calldata commitment mismatch".to_string()),
                    );
                }

                let realized_profit = match matching_arbitrage_profit(&receipt.logs, &expected) {
                    Ok(Some(value)) => value,
                    Ok(None) => {
                        return base(
                            TerminalExecutionState::EvidenceMismatch,
                            Some("matching ArbitrageExecuted event is absent".to_string()),
                        )
                    }
                    Err(error) => {
                        return base(TerminalExecutionState::EvidenceMismatch, Some(error.to_string()))
                    }
                };
                let minimum_profit = match expected.minimum_profit_base_units.parse::<u128>() {
                    Ok(value) => value,
                    Err(_) => {
                        return base(
                            TerminalExecutionState::EvidenceMismatch,
                            Some("minimum profit is not a base-unit integer".to_string()),
                        )
                    }
                };

                loop {
                    if Utc::now() >= expires_at + chrono::Duration::seconds(15) {
                        return base(
                            TerminalExecutionState::EvidenceMismatch,
                            Some("finality was not observed before the evidence timeout".to_string()),
                        );
                    }
                    match rpc.finalized_block().await {
                        Ok(finalized) => {
                            let finalized_number = match parse_hex_u64(&finalized.number) {
                                Ok(value) => value,
                                Err(error) => {
                                    return base(
                                        TerminalExecutionState::EvidenceMismatch,
                                        Some(error.to_string()),
                                    )
                                }
                            };
                            if finalized_number >= included_block {
                                let before = rpc
                                    .token_balance(
                                        &expected.profit_token,
                                        &expected.profit_recipient,
                                        included_block.saturating_sub(1),
                                    )
                                    .await
                                    .ok();
                                let after = rpc
                                    .token_balance(
                                        &expected.profit_token,
                                        &expected.profit_recipient,
                                        included_block,
                                    )
                                    .await
                                    .ok();
                                return ExecutionEvidence {
                                    schema_version: 1,
                                    execution_id,
                                    environment: "LIVE".to_string(),
                                    terminal_state: if realized_profit >= minimum_profit {
                                        TerminalExecutionState::FinalizedProfit
                                    } else {
                                        TerminalExecutionState::FinalizedLoss
                                    },
                                    tx_hash: Some(tx_hash),
                                    opportunity_hash,
                                    calldata_hash: expected.calldata_hash,
                                    included_block_number: Some(included_block),
                                    included_block_hash: Some(receipt.block_hash),
                                    finalized_block_number: Some(finalized_number),
                                    finalized_block_hash: Some(finalized.hash),
                                    before_balance_base_units: before.map(|value| value.to_string()),
                                    after_balance_base_units: after.map(|value| value.to_string()),
                                    realized_profit_base_units: Some(realized_profit.to_string()),
                                    observed_inclusion_ms: Some(inclusion_ms),
                                    observed_finality_ms: Some(
                                        submitted_at.elapsed().as_millis() as u64,
                                    ),
                                    relay_acknowledgements: acknowledgements,
                                    error: None,
                                    recorded_at: Utc::now(),
                                };
                            }
                        }
                        Err(error) => tracing::warn!(%error, "finalized block query failed"),
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
            }
            Ok(None) => {}
            Err(error) => tracing::warn!(%error, "receipt query failed"),
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
