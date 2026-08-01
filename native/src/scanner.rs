use crate::{
    model::{Opportunity, OpportunityFeatures, SimulationProof},
    reconcile::keccak_hex,
    rpc::{normalize_address, parse_hex_u128, parse_hex_u64, BscRpcClient},
};
use anyhow::{bail, Context, Result};
use chrono::Utc;
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{env, time::Duration};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScannerConfig {
    enabled: bool,
    control_plane_url: String,
    internal_token_env: String,
    user_id: String,
    strategy_id: String,
    websocket_rpc_url: String,
    pair_buy: String,
    pair_sell: String,
    router_buy: String,
    router_sell: String,
    token_in: String,
    token_out: String,
    token_in_is_token0_buy: bool,
    token_in_is_token0_sell: bool,
    token_in_decimals: u32,
    token_in_usd_micros: u64,
    amount_in_base_units: String,
    minimum_profit_base_units: String,
    gas_usd_micros: i64,
    relay_usd_micros: i64,
    slippage_usd_micros: i64,
    #[serde(default = "default_starting_capital")]
    starting_capital_usd_micros: i64,
    #[serde(default = "default_fee_bps")]
    buy_fee_bps: u32,
    #[serde(default = "default_fee_bps")]
    sell_fee_bps: u32,
}

fn default_fee_bps() -> u32 {
    25
}

fn default_starting_capital() -> i64 {
    100_000_000
}

#[derive(Clone, Copy)]
struct Reserves {
    reserve0: u128,
    reserve1: u128,
}

fn parse_reserves(value: &str) -> Result<Reserves> {
    let data = value.trim_start_matches("0x");
    if data.len() < 192 {
        bail!("getReserves returned fewer than three ABI words");
    }
    Ok(Reserves {
        reserve0: parse_hex_u128(&format!("0x{}", &data[0..64]))?,
        reserve1: parse_hex_u128(&format!("0x{}", &data[64..128]))?,
    })
}

fn amount_out(amount_in: u128, reserve_in: u128, reserve_out: u128, fee_bps: u32) -> u128 {
    if amount_in == 0 || reserve_in == 0 || reserve_out == 0 || fee_bps >= 10_000 {
        return 0;
    }
    let fee_multiplier = 10_000_u128 - fee_bps as u128;
    let amount_with_fee = match amount_in.checked_mul(fee_multiplier) {
        Some(value) => value,
        None => return 0,
    };
    let numerator = match amount_with_fee.checked_mul(reserve_out) {
        Some(value) => value,
        None => return 0,
    };
    let denominator = match reserve_in
        .checked_mul(10_000)
        .and_then(|value| value.checked_add(amount_with_fee))
    {
        Some(value) if value > 0 => value,
        _ => return 0,
    };
    numerator / denominator
}

fn usd_micros(base_units: u128, token_usd_micros: u64, decimals: u32) -> Result<i64> {
    if decimals > 30 {
        bail!("tokenInDecimals exceeds the supported fixed-point range");
    }
    let denominator = 10_u128.pow(decimals);
    let value = base_units
        .checked_mul(token_usd_micros as u128)
        .context("USD conversion overflow")?
        / denominator;
    i64::try_from(value).context("USD micro value exceeds i64")
}

async fn read_pair(rpc: &BscRpcClient, pair: &str, block: &str) -> Result<(Reserves, String)> {
    let raw = rpc.call_contract(pair, "0x0902f1ac", block).await?;
    Ok((parse_reserves(&raw)?, raw))
}

async fn process_block(
    config: &ScannerConfig,
    rpc: &BscRpcClient,
    internal_token: &str,
    block_number: u64,
    block_hash: &str,
) -> Result<()> {
    let block_tag = format!("0x{block_number:x}");
    let ((buy, buy_raw), (sell, sell_raw)) = tokio::try_join!(
        read_pair(rpc, &config.pair_buy, &block_tag),
        read_pair(rpc, &config.pair_sell, &block_tag),
    )?;
    let amount_in = config.amount_in_base_units.parse::<u128>()?;
    let min_profit = config.minimum_profit_base_units.parse::<u128>()?;
    let (buy_in, buy_out) = if config.token_in_is_token0_buy {
        (buy.reserve0, buy.reserve1)
    } else {
        (buy.reserve1, buy.reserve0)
    };
    // On the sell pair, tokenIn is the output of the second swap.
    let (sell_intermediate, sell_token_in) = if config.token_in_is_token0_sell {
        (sell.reserve1, sell.reserve0)
    } else {
        (sell.reserve0, sell.reserve1)
    };
    let intermediate = amount_out(amount_in, buy_in, buy_out, config.buy_fee_bps);
    let final_amount = amount_out(
        intermediate,
        sell_intermediate,
        sell_token_in,
        config.sell_fee_bps,
    );
    if final_amount <= amount_in || final_amount - amount_in < min_profit {
        return Ok(());
    }
    let gross_profit = final_amount - amount_in;
    let gross_profit_usd_micros = usd_micros(
        gross_profit,
        config.token_in_usd_micros,
        config.token_in_decimals,
    )?;
    if gross_profit_usd_micros
        <= config.gas_usd_micros + config.relay_usd_micros + config.slippage_usd_micros
    {
        return Ok(());
    }
    let notional_usd_micros = usd_micros(
        amount_in,
        config.token_in_usd_micros,
        config.token_in_decimals,
    )?;
    let minimum_token_in_reserve = buy_in.min(sell_token_in);
    let available_liquidity_usd_micros = usd_micros(
        minimum_token_in_reserve,
        config.token_in_usd_micros,
        config.token_in_decimals,
    )?;
    let observation_id = format!(
        "{}-{}-{}",
        config.strategy_id,
        block_number,
        &keccak_hex(format!("{buy_raw}{sell_raw}").as_bytes())[2..18]
    );
    let opportunity = Opportunity {
        observation_id,
        observed_at: Utc::now(),
        strategy: config.strategy_id.clone(),
        features: OpportunityFeatures {
            gross_profit_usd_micros,
            gas_usd_micros: config.gas_usd_micros,
            relay_usd_micros: config.relay_usd_micros,
            slippage_usd_micros: config.slippage_usd_micros,
            notional_usd_micros,
            available_liquidity_usd_micros,
            // The control plane replaces this with its server-owned calibrated
            // probability before live submission.
            calibrated_probability_ppm: 0,
            data_age_ms: 0,
            estimated_latency_ms: 0,
        },
        simulation: SimulationProof {
            success: true,
            state_block: block_number,
            state_block_hash: block_hash.to_string(),
            call_result_hash: keccak_hex(format!("{buy_raw}{sell_raw}").as_bytes()),
            protected_route: true,
        },
    };
    let realized_net_profit_usd_micros = gross_profit_usd_micros
        - config.gas_usd_micros
        - config.relay_usd_micros
        - config.slippage_usd_micros;
    let payload = json!({
        "uid": config.user_id,
        "strategyId": config.strategy_id,
        "opportunity": opportunity,
        "realizedNetProfitUsdMicros": realized_net_profit_usd_micros,
        "startingCapitalUsdMicros": config.starting_capital_usd_micros,
        "route": {
            "tokenIn": config.token_in,
            "amountInBaseUnits": config.amount_in_base_units,
            "routerBuy": config.router_buy,
            "routerSell": config.router_sell,
            "buyPath": [config.token_in, config.token_out],
            "sellPath": [config.token_out, config.token_in],
            "minimumProfitBaseUnits": config.minimum_profit_base_units,
            "recipient": env::var("MEV_SCANNER_PROFIT_RECIPIENT")?
        }
    });
    let client = Client::builder()
        .timeout(Duration::from_secs(55))
        .build()?;
    let observe_response = client
        .post(format!(
            "{}/api/mev/internal/observe",
            config.control_plane_url.trim_end_matches('/')
        ))
        .header("x-mev-internal-token", internal_token)
        .json(&payload)
        .send()
        .await?;
    if observe_response.status().as_u16() == 409 {
        return Ok(());
    }
    if !observe_response.status().is_success() {
        let error = observe_response.text().await.unwrap_or_default();
        bail!("control plane rejected opportunity: {error}");
    }
    let observation_result: Value = observe_response.json().await?;
    if observation_result["executeAuthorized"].as_bool() == Some(true) {
        let execute_response = client
            .post(format!(
                "{}/api/mev/internal/execute",
                config.control_plane_url.trim_end_matches('/')
            ))
            .header("x-mev-internal-token", internal_token)
            .json(&payload)
            .send()
            .await?;
        if !execute_response.status().is_success() {
            let error = execute_response.text().await.unwrap_or_default();
            bail!("authorized live execution failed: {error}");
        }
    }
    Ok(())
}

pub async fn run_scanner(rpc: BscRpcClient) -> Result<()> {
    let raw = env::var("MEV_SCANNER_CONFIG_JSON").context("MEV_SCANNER_CONFIG_JSON is absent")?;
    let config: ScannerConfig = serde_json::from_str(&raw)?;
    if !config.enabled {
        return Ok(());
    }
    for address in [
        &config.pair_buy,
        &config.pair_sell,
        &config.router_buy,
        &config.router_sell,
        &config.token_in,
        &config.token_out,
    ] {
        normalize_address(address)?;
    }
    if !(config.websocket_rpc_url.starts_with("wss://")
        || config.websocket_rpc_url.starts_with("ws://127.0.0.1"))
    {
        bail!("scanner WebSocket must use WSS or loopback WS");
    }
    let internal_token = env::var(&config.internal_token_env)?;
    loop {
        match connect_async(&config.websocket_rpc_url).await {
            Ok((mut socket, _)) => {
                socket
                    .send(Message::Text(
                        json!({"jsonrpc":"2.0","id":1,"method":"eth_subscribe","params":["newHeads"]})
                            .to_string()
                            .into(),
                    ))
                    .await?;
                while let Some(message) = socket.next().await {
                    let text = match message? {
                        Message::Text(value) => value,
                        _ => continue,
                    };
                    let body: Value = match serde_json::from_str(&text) {
                        Ok(value) => value,
                        Err(_) => continue,
                    };
                    let head = &body["params"]["result"];
                    let (Some(number), Some(hash)) = (head["number"].as_str(), head["hash"].as_str()) else {
                        continue;
                    };
                    let block_number = parse_hex_u64(number)?;
                    if let Err(error) = process_block(
                        &config,
                        &rpc,
                        &internal_token,
                        block_number,
                        hash,
                    )
                    .await
                    {
                        tracing::warn!(%error, block_number, "scanner opportunity processing failed");
                    }
                }
            }
            Err(error) => tracing::warn!(%error, "scanner WebSocket disconnected"),
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_product_quote_charges_fee() {
        assert_eq!(amount_out(1_000, 1_000_000, 2_000_000, 25), 1_993);
        assert_eq!(amount_out(0, 1_000, 1_000, 25), 0);
    }
}
