use crate::{
    amm::{self, CycleLegs},
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
use std::{
    env,
    time::{Duration, Instant},
};
use tokio_tungstenite::{connect_async, tungstenite::Message};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScannerConfig {
    /// Read from the raw JSON before this struct is deserialized, so that a
    /// disabled placeholder need not satisfy every route field. Retained here so
    /// the type still documents and validates the full schema.
    #[allow(dead_code)]
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
    /// Maximum tolerated divergence between our reserve model and the router's
    /// own quote before the opportunity is discarded.
    #[serde(default = "default_router_tolerance_bps")]
    router_quote_tolerance_bps: u32,
    /// Defaults to `true`. When disabled, opportunities are still observed but
    /// are marked unverified and cannot satisfy the kernel's simulation gate.
    #[serde(default = "default_require_router_verification")]
    require_router_verification: bool,
    /// Budgeted one-way time from dispatching an opportunity to the bundle
    /// reaching a builder. Added to the measured in-block elapsed time to form
    /// `estimated_latency_ms`.
    #[serde(default = "default_relay_latency_budget_ms")]
    relay_latency_budget_ms: u32,
    /// Mirror of the executor's on-chain `maxAmountIn[tokenIn]`.
    ///
    /// Sizing previously consulted only `amountInBaseUnits`, so the searched
    /// optimum could exceed the contract's own per-token ceiling — producing a
    /// trade that is guaranteed to revert with `AMOUNT_ABOVE_CAP` after paying
    /// gas. Keep this in sync with the deployed value; when unset, no additional
    /// ceiling is applied.
    #[serde(default)]
    executor_max_amount_in_base_units: Option<String>,
}

fn default_fee_bps() -> u32 {
    25
}

fn default_router_tolerance_bps() -> u32 {
    // 0.30%. Wide enough to absorb integer truncation across two hops, tight
    // enough that a fee-on-transfer token cannot hide inside it.
    30
}

fn default_require_router_verification() -> bool {
    true
}

fn default_relay_latency_budget_ms() -> u32 {
    // Conservative single-digit-to-low-double-digit relay hops plus scheduling
    // slack. Deliberately pessimistic: over-estimating latency rejects
    // marginal opportunities, under-estimating sends bundles that arrive after
    // the state they were priced against has already moved.
    120
}

/// Milliseconds elapsed since `since`, clamped into u32.
///
/// Saturating rather than wrapping is load-bearing: a stalled scanner must
/// report "impossibly stale" and be rejected, never wrap around to "fresh".
fn elapsed_ms_u32(since: Instant) -> u32 {
    u32::try_from(since.elapsed().as_millis()).unwrap_or(u32::MAX)
}

/// Expected total in-flight latency relative to the state an opportunity was
/// priced against: time already burned this block, plus the submission hop.
fn latency_estimate_ms(data_age_ms: u32, relay_budget_ms: u32) -> u32 {
    data_age_ms.saturating_add(relay_budget_ms)
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

/// Quote a path through a real router at a pinned block.
///
/// This is the execution-truth check that reserve arithmetic cannot perform:
/// `getAmountsOut` runs the router's own code against live state, so a token
/// that taxes transfers, rebases supply, or blocks the pair shows up here as a
/// quote that disagrees with the model — before any funds are committed.
async fn router_quote(
    rpc: &BscRpcClient,
    router: &str,
    amount_in: u128,
    path: &[String],
    block: &str,
) -> Result<u128> {
    let calldata = amm::encode_get_amounts_out(amount_in, path)?;
    let raw = rpc.call_contract(router, &calldata, block).await?;
    amm::decode_final_amount(&raw)
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

/// Orient both pairs into a buy-then-sell cycle for the configured input token.
fn orient_legs(config: &ScannerConfig, buy: Reserves, sell: Reserves) -> CycleLegs {
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
    CycleLegs {
        buy_reserve_in: buy_in,
        buy_reserve_out: buy_out,
        buy_fee_bps: config.buy_fee_bps,
        sell_reserve_in: sell_intermediate,
        sell_reserve_out: sell_token_in,
        sell_fee_bps: config.sell_fee_bps,
    }
}

/// Evaluate one block. Returns a decision to be settled at the next block, or
/// `None` when nothing cleared the gates.
async fn evaluate_block(
    config: &ScannerConfig,
    rpc: &BscRpcClient,
    block_number: u64,
    block_hash: &str,
    // Captured the instant the `newHeads` frame arrived, before any parsing or
    // RPC work. Everything spent after this point counts against the freshness
    // of the state the opportunity is priced against.
    head_received_at: Instant,
) -> Result<Option<PendingDecision>> {
    let block_tag = format!("0x{block_number:x}");
    let ((buy, buy_raw), (sell, sell_raw)) = tokio::try_join!(
        read_pair(rpc, &config.pair_buy, &block_tag),
        read_pair(rpc, &config.pair_sell, &block_tag),
    )?;
    // The size is bounded by every ceiling that will actually be applied to it,
    // not just the configured notional. Sizing above the on-chain cap buys a
    // guaranteed AMOUNT_ABOVE_CAP revert at full gas cost.
    let mut amount_in_cap = config.amount_in_base_units.parse::<u128>()?;
    if let Some(executor_cap) = &config.executor_max_amount_in_base_units {
        amount_in_cap = amount_in_cap.min(executor_cap.parse::<u128>()?);
    }
    let min_profit = config.minimum_profit_base_units.parse::<u128>()?;
    let legs = orient_legs(config, buy, sell);
    let buy_in = legs.buy_reserve_in;
    let sell_token_in = legs.sell_reserve_out;
    // Size to the profit-maximising amount for THIS block's reserves rather
    // than a fixed configured notional. `amountInBaseUnits` is retained as a
    // hard ceiling, so sizing can only move down from the previous behaviour
    // and never past the operator's risk limit.
    let sized = amm::optimal_amount_in(&legs, amount_in_cap);
    if sized.amount_in == 0 || sized.gross_profit < min_profit {
        return Ok(None);
    }
    let amount_in = sized.amount_in;
    let gross_profit = sized.gross_profit;
    let gross_profit_usd_micros = usd_micros(
        gross_profit,
        config.token_in_usd_micros,
        config.token_in_decimals,
    )?;
    if gross_profit_usd_micros
        <= config.gas_usd_micros + config.relay_usd_micros + config.slippage_usd_micros
    {
        return Ok(None);
    }

    // Execution-truth cross-check. Reserve arithmetic describes a well-behaved
    // pair; it is blind to fee-on-transfer tokens, rebasing supply, blacklists,
    // and routers whose fee differs from the configured assumption. Each of
    // those reads as profitable above and fails on execution. Quoting both
    // routers at the same pinned block is what separates a modelled profit from
    // an executable one.
    //
    // `route_verified` is reported honestly downstream: when verification is
    // disabled the opportunity is still recorded for evidence, but it declares
    // itself unverified and therefore cannot satisfy the kernel's simulation
    // gate for live execution.
    let route_verified = if config.require_router_verification {
        let buy_quote = router_quote(
            rpc,
            &config.router_buy,
            amount_in,
            &[config.token_in.clone(), config.token_out.clone()],
            &block_tag,
        )
        .await?;
        let round_trip_quote = router_quote(
            rpc,
            &config.router_sell,
            buy_quote,
            &[config.token_out.clone(), config.token_in.clone()],
            &block_tag,
        )
        .await?;
        let modelled_out = legs.round_trip_out(amount_in);
        if !amm::quotes_agree(
            modelled_out,
            round_trip_quote,
            config.router_quote_tolerance_bps,
        ) {
            tracing::warn!(
                block_number,
                modelled_out,
                router_out = round_trip_quote,
                tolerance_bps = config.router_quote_tolerance_bps,
                "router quote diverged from the reserve model; opportunity discarded"
            );
            return Ok(None);
        }
        // Re-apply the profit floor against the router's own number, not ours.
        if round_trip_quote <= amount_in || round_trip_quote - amount_in < min_profit {
            return Ok(None);
        }
        true
    } else {
        false
    };

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
    // Measured, not assumed. Both fields were previously hardcoded to 0, which
    // silently disabled two of the kernel's eight risk gates: `0 > 900` and
    // `0 > 1000` are never true, so MEV_REJECT_STALE_DATA and MEV_REJECT_LATENCY
    // could not fire under any conditions. On 0.45s blocks, staleness is the
    // gate that matters most — the reserves this route was priced against are
    // superseded roughly twice a second.
    let data_age_ms = elapsed_ms_u32(head_received_at);
    let estimated_latency_ms = latency_estimate_ms(data_age_ms, config.relay_latency_budget_ms);

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
            data_age_ms,
            estimated_latency_ms,
        },
        simulation: SimulationProof {
            // Only claims success when the route was actually quoted against
            // the live routers. An unverified route reports false and is
            // rejected by the kernel's simulation gate.
            success: route_verified,
            state_block: block_number,
            state_block_hash: block_hash.to_string(),
            call_result_hash: keccak_hex(format!("{buy_raw}{sell_raw}").as_bytes()),
            protected_route: true,
        },
    };
    let route = json!({
        "tokenIn": config.token_in,
        // The executed size is the searched optimum, not the configured
        // ceiling. Sending the ceiling here would execute a different trade
        // than the one that was priced and verified above.
        "amountInBaseUnits": amount_in.to_string(),
        "routerBuy": config.router_buy,
        "routerSell": config.router_sell,
        "buyPath": [config.token_in, config.token_out],
        "sellPath": [config.token_out, config.token_in],
        "minimumProfitBaseUnits": config.minimum_profit_base_units,
        "recipient": env::var("MEV_SCANNER_PROFIT_RECIPIENT")?
    });

    // The decision is NOT reported here. Reporting at decision time is what made
    // the evidence sample worthless: this function returns early for every
    // candidate that fails the profit test, so anything reported from this point
    // is profitable by construction and `profitableCount == sampleCount` always.
    // The outcome is measured one block later by `settle_decision`, where it can
    // be — and frequently will be — negative.
    Ok(Some(PendingDecision {
        opportunity,
        amount_in,
        min_profit,
        route,
    }))
}

/// A decision taken at block N, awaiting outcome measurement at block N+1.
#[derive(Clone, Debug)]
struct PendingDecision {
    opportunity: Opportunity,
    amount_in: u128,
    min_profit: u128,
    route: Value,
}

/// Measure what the decision actually netted, and report that as the sample.
///
/// The arbitrage would have landed in the block after it was priced, by which
/// time other searchers have acted on the same dislocation. Re-pricing the
/// identical trade against the settlement block's reserves is what distinguishes
/// an opportunity that survived from one that evaporated.
///
/// The executor is atomic, so the loss is bounded and asymmetric: if the round
/// trip no longer clears `amountIn + minProfit`, the transaction reverts and the
/// only cost is gas. That is modelled exactly, because reporting a full
/// principal loss would be as dishonest as reporting a guaranteed win.
///
/// Returns the control plane's current live-execution authorization.
async fn settle_decision(
    config: &ScannerConfig,
    rpc: &BscRpcClient,
    internal_token: &str,
    decision: &PendingDecision,
    settlement_block: u64,
) -> Result<bool> {
    let block_tag = format!("0x{settlement_block:x}");
    let ((buy, _), (sell, _)) = tokio::try_join!(
        read_pair(rpc, &config.pair_buy, &block_tag),
        read_pair(rpc, &config.pair_sell, &block_tag),
    )?;
    let legs = orient_legs(config, buy, sell);
    let settled_out = legs.round_trip_out(decision.amount_in);

    let realized_net_profit_usd_micros = if settled_out
        >= decision.amount_in.saturating_add(decision.min_profit)
    {
        let gross = settled_out - decision.amount_in;
        usd_micros(gross, config.token_in_usd_micros, config.token_in_decimals)?
            - config.gas_usd_micros
            - config.relay_usd_micros
            - config.slippage_usd_micros
    } else {
        // Reverted on the executor's own minProfit floor: gas is spent, the
        // principal is untouched.
        -config.gas_usd_micros
    };

    tracing::info!(
        settlement_block,
        amount_in = %decision.amount_in,
        realized_net_profit_usd_micros,
        survived = realized_net_profit_usd_micros > 0,
        "settled scanner decision"
    );

    let payload = json!({
        "uid": config.user_id,
        "strategyId": config.strategy_id,
        "opportunity": decision.opportunity,
        "realizedNetProfitUsdMicros": realized_net_profit_usd_micros,
        "startingCapitalUsdMicros": config.starting_capital_usd_micros,
        "route": decision.route,
    });
    let client = Client::builder().timeout(Duration::from_secs(55)).build()?;
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
        return Ok(false);
    }
    if !observe_response.status().is_success() {
        let error = observe_response.text().await.unwrap_or_default();
        bail!("control plane rejected observation: {error}");
    }
    let observation_result: Value = observe_response.json().await?;
    Ok(observation_result["executeAuthorized"].as_bool() == Some(true))
}

/// Dispatch an authorized live execution for a freshly priced decision.
///
/// Execution deliberately does not wait on the settlement round trip: the
/// authorization it carries is a strategy-mode fact, not a per-trade one, so it
/// is cached from the previous block. Waiting a block for permission would
/// guarantee the trade is stale by the time it is submitted.
async fn dispatch_execution(
    config: &ScannerConfig,
    internal_token: &str,
    decision: &PendingDecision,
) -> Result<()> {
    let payload = json!({
        "uid": config.user_id,
        "strategyId": config.strategy_id,
        "opportunity": decision.opportunity,
        "startingCapitalUsdMicros": config.starting_capital_usd_micros,
        "route": decision.route,
    });
    let client = Client::builder().timeout(Duration::from_secs(55)).build()?;
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
    Ok(())
}

pub async fn run_scanner(rpc: BscRpcClient) -> Result<()> {
    let raw = env::var("MEV_SCANNER_CONFIG_JSON").context("MEV_SCANNER_CONFIG_JSON is absent")?;
    // Read the kill switch before full deserialization. A deliberately disabled
    // placeholder should not have to satisfy every route field — requiring that
    // turns "scanner is off" into a startup error that looks like a fault.
    let probe: Value =
        serde_json::from_str(&raw).context("MEV_SCANNER_CONFIG_JSON is not valid JSON")?;
    if probe.get("enabled").and_then(Value::as_bool) != Some(true) {
        tracing::info!("scanner is disabled by configuration; no route will be evaluated");
        return Ok(());
    }
    let config: ScannerConfig = serde_json::from_str(&raw)?;
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
    // Survives reconnects as a strategy-mode fact; the pending decision does
    // not, because a gap in the head stream means the settlement block would no
    // longer be the block the trade would actually have landed in.
    let mut execute_authorized = false;
    loop {
        let mut pending: Option<PendingDecision> = None;
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
                    // Stamped before parsing so decode time counts against
                    // freshness rather than being invisible.
                    let head_received_at = Instant::now();
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

                    // Settle the previous block's decision against this block's
                    // state before evaluating anything new. This is the only
                    // path that reports evidence, and it is the only one that
                    // can report a loss.
                    if let Some(decision) = pending.take() {
                        match settle_decision(
                            &config,
                            &rpc,
                            &internal_token,
                            &decision,
                            block_number,
                        )
                        .await
                        {
                            Ok(authorized) => execute_authorized = authorized,
                            Err(error) => {
                                tracing::warn!(%error, block_number, "decision settlement failed")
                            }
                        }
                    }

                    match evaluate_block(
                        &config,
                        &rpc,
                        block_number,
                        hash,
                        head_received_at,
                    )
                    .await
                    {
                        Ok(Some(decision)) => {
                            if execute_authorized {
                                if let Err(error) =
                                    dispatch_execution(&config, &internal_token, &decision).await
                                {
                                    tracing::warn!(%error, block_number, "live execution dispatch failed");
                                }
                            }
                            pending = Some(decision);
                        }
                        Ok(None) => {}
                        Err(error) => {
                            tracing::warn!(%error, block_number, "scanner opportunity processing failed")
                        }
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

    /// A config written before router verification existed must not silently
    /// run unverified. Absent fields have to default to the safe side.
    #[test]
    fn legacy_config_defaults_to_verified_routes() {
        let legacy = serde_json::json!({
            "enabled": true,
            "controlPlaneUrl": "https://control.invalid",
            "internalTokenEnv": "MEV_EXECUTOR_INTERNAL_TOKEN",
            "userId": "uid",
            "strategyId": "strategy",
            "websocketRpcUrl": "wss://rpc.invalid",
            "pairBuy": "0x0000000000000000000000000000000000000001",
            "pairSell": "0x0000000000000000000000000000000000000002",
            "routerBuy": "0x0000000000000000000000000000000000000003",
            "routerSell": "0x0000000000000000000000000000000000000004",
            "tokenIn": "0x0000000000000000000000000000000000000005",
            "tokenOut": "0x0000000000000000000000000000000000000006",
            "tokenInIsToken0Buy": true,
            "tokenInIsToken0Sell": false,
            "tokenInDecimals": 18,
            "tokenInUsdMicros": 1_000_000,
            "amountInBaseUnits": "1000000000000000000",
            "minimumProfitBaseUnits": "1000000000000000",
            "gasUsdMicros": 500_000,
            "relayUsdMicros": 100_000,
            "slippageUsdMicros": 100_000
        });
        let config: ScannerConfig = serde_json::from_value(legacy).expect("config parses");
        assert!(config.require_router_verification);
        assert_eq!(config.router_quote_tolerance_bps, 30);
        assert_eq!(config.relay_latency_budget_ms, 120);
    }

    fn cycle(buy_out: u128, sell_out: u128) -> CycleLegs {
        CycleLegs {
            buy_reserve_in: 1_000_000,
            buy_reserve_out: buy_out,
            buy_fee_bps: 25,
            sell_reserve_in: 1_000_000,
            sell_reserve_out: sell_out,
            sell_fee_bps: 25,
        }
    }

    /// Mirrors the branch in `settle_decision`. An opportunity that evaporates
    /// before the settlement block must produce a NEGATIVE sample, otherwise the
    /// evidence window is a filtered list of winners and every statistical gate
    /// downstream is measuring the filter rather than the strategy.
    fn realized(legs: &CycleLegs, amount_in: u128, min_profit: u128, gas: i64) -> i64 {
        let settled_out = legs.round_trip_out(amount_in);
        if settled_out >= amount_in.saturating_add(min_profit) {
            usd_micros(settled_out - amount_in, 1_000_000, 6).unwrap() - gas
        } else {
            -gas
        }
    }

    #[test]
    fn an_opportunity_that_survives_settles_positive() {
        let profitable = cycle(1_000_000, 1_300_000);
        let outcome = realized(&profitable, 1_000, 1, 100);
        assert!(outcome > 0, "surviving dislocation must settle positive");
    }

    /// The case the old code could not represent at all.
    #[test]
    fn an_opportunity_taken_by_someone_else_settles_negative() {
        // Reserves have re-balanced by the settlement block: no dislocation left.
        let gone = cycle(1_000_000, 1_000_000);
        let outcome = realized(&gone, 1_000, 1, 100);
        assert_eq!(outcome, -100, "a lost race costs exactly the gas");
        assert!(outcome < 0);
    }

    /// The executor is atomic, so an evaporated opportunity costs gas and never
    /// the principal. Reporting a full principal loss would be as dishonest as
    /// reporting a guaranteed win.
    #[test]
    fn a_reverted_trade_never_reports_a_principal_loss() {
        let collapsed = cycle(1_000_000, 10);
        let gas = 500_000_i64;
        let outcome = realized(&collapsed, 1_000_000_000, 1, gas);
        assert_eq!(outcome, -gas);
    }

    #[test]
    fn latency_estimate_adds_the_submission_budget() {
        assert_eq!(latency_estimate_ms(80, 120), 200);
        assert_eq!(latency_estimate_ms(0, 0), 0);
    }

    /// A wrap here would report a stalled scanner as low-latency and let the
    /// kernel's latency gate pass on state that is seconds out of date.
    #[test]
    fn latency_estimate_saturates_instead_of_wrapping() {
        assert_eq!(latency_estimate_ms(u32::MAX, 120), u32::MAX);
        assert_eq!(latency_estimate_ms(u32::MAX - 1, 5), u32::MAX);
    }

    /// The gates these fields feed must actually be reachable. Previously both
    /// were hardcoded to 0 and could never trip.
    #[test]
    fn measured_values_can_trip_the_kernel_gates() {
        let limits = crate::model::RiskLimits::default();
        let stale_age = limits.max_data_age_ms + 1;
        assert!(stale_age > limits.max_data_age_ms, "staleness gate reachable");
        assert!(
            latency_estimate_ms(stale_age, default_relay_latency_budget_ms())
                > limits.max_estimated_latency_ms,
            "latency gate reachable"
        );
        // And a healthy block must still pass both.
        let healthy_age = 60;
        assert!(healthy_age < limits.max_data_age_ms);
        assert!(
            latency_estimate_ms(healthy_age, default_relay_latency_budget_ms())
                < limits.max_estimated_latency_ms
        );
    }

    /// `elapsed_ms_u32` must never report a fresher age than reality.
    #[test]
    fn elapsed_is_monotonic_and_non_negative() {
        let started = Instant::now();
        std::thread::sleep(Duration::from_millis(5));
        assert!(elapsed_ms_u32(started) >= 5);
    }
}
