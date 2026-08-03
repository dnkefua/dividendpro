//! Opportunity survey — does a dislocation ever appear, and does it *persist*?
//!
//! The pair scan established that no liquid v2 route on BSC is instantaneously
//! profitable: 72 routes over 1,800 samples, best observation 5 bps underwater.
//! That is the signature of a market arbitraged to cost by someone faster.
//!
//! This module asks the question that actually decides whether the other
//! roadmap items are worth building. Competitive research puts an opportunity's
//! life at 150–400 ms, with returns below gas cost by ~200 ms. A route that
//! clears the fee floor and *stays* clear for several blocks is, by definition,
//! one that nobody faster is taking — and that is the only kind this system can
//! realistically win.
//!
//! So the metric is not "is there a spread" but "how long does it last".
//!
//! Two phases, because cost forces it. Pricing N routes every block over a wide
//! universe is prohibitive: 36 pairs at 0.45 s blocks is ~7 M RPC calls a day.
//!
//!   Phase A (this module, `SurveyMode::Wide`)
//!     Many pairs, coarse cadence. Answers "does anything ever cross the floor".
//!     Cheap enough to run for days.
//!
//!   Phase B (`SurveyMode::Focused`)
//!     Only the routes Phase A flagged, every block. Measures persistence at
//!     block resolution, which is the number the roadmap decision turns on.
//!
//! Nothing here can trade. The survey has no signer, no relay, and no execution
//! path — it observes and reports.

use crate::{
    amm::{self, CycleLegs},
    rpc::{normalize_address, parse_hex_u128, BscRpcClient},
};
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// A venue's factory and its swap fee.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Venue {
    pub name: String,
    pub factory: String,
    /// Measured, never assumed. Biswap is 20 bps and is widely misquoted as 10;
    /// taking the published figure would bias every route optimistically.
    pub fee_bps: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SurveyMode {
    /// Wide universe, coarse cadence — "does anything ever cross".
    Wide,
    /// Flagged routes only, every block — "how long does it stay across".
    Focused,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurveyConfig {
    pub enabled: bool,
    pub mode: SurveyMode,
    pub venues: Vec<Venue>,
    /// Tokens to pair against `quote_token`.
    pub tokens: Vec<String>,
    pub quote_token: String,
    /// Probe size as a fraction of the source pool, in bps. Small enough that
    /// price impact does not swamp the divergence being measured.
    #[serde(default = "default_probe_bps")]
    pub probe_bps: u32,
    /// Sample every N blocks. Ignored in `Focused` mode, which samples each block.
    #[serde(default = "default_sample_every")]
    pub sample_every_n_blocks: u64,
    /// Minimum quote-token reserve, in wei, for BOTH legs of a route.
    ///
    /// Without this, persistence selects for irrelevance. The first run flagged
    /// four routes positive on 20/20 samples — including ALPACA at +115 bps —
    /// and every one ran through an abandoned pool: $10, $250, $450 of total
    /// liquidity. They persist *because* they are worthless; nobody arbitrages
    /// ten dollars, so the price drifts freely. The apparent edge was real
    /// arithmetic over meaningless depth.
    #[serde(default = "default_min_quote_reserve_wei")]
    pub min_quote_reserve_wei: String,
    /// Minimum absolute round-trip profit, in quote wei, for a sample to count
    /// as positive. A basis-point gain on a dust pool is cents; gas is not.
    #[serde(default = "default_min_abs_profit_wei")]
    pub min_abs_profit_wei: String,
}

fn default_min_quote_reserve_wei() -> String {
    // 50 WBNB per side (~$29k). Below this, a trade large enough to clear gas
    // moves the pool more than the dislocation it is chasing.
    "50000000000000000000".to_string()
}

fn default_min_abs_profit_wei() -> String {
    // 0.002 WBNB (~$1.20) — comfortably above the ~$0.23–0.40 gas estimate.
    "2000000000000000".to_string()
}

fn default_probe_bps() -> u32 {
    5 // 0.05% of the source pool
}

fn default_sample_every() -> u64 {
    10
}

/// One directional route between two venues for a token pair.
#[derive(Clone, Debug)]
pub struct Route {
    pub token: String,
    pub buy_venue: String,
    pub sell_venue: String,
    pub buy_pair: String,
    pub sell_pair: String,
    pub buy_fee_bps: u32,
    pub sell_fee_bps: u32,
    /// True when `token` sorts below the quote token, so reserve0 is `token`.
    pub token_is_reserve0: bool,
}

impl Route {
    pub fn key(&self) -> String {
        format!("{} {}->{}", self.token, self.buy_venue, self.sell_venue)
    }
}

/// Running persistence state for a single route.
#[derive(Clone, Debug, Default, Serialize)]
pub struct RouteStats {
    pub samples: u64,
    /// Samples whose round trip cleared the fee floor.
    pub positive_samples: u64,
    /// Best round-trip result seen, in bps (negative = underwater).
    pub best_bps: i64,
    /// Longest unbroken run of positive samples. THE number that matters:
    /// a run of 1 is a blink no external searcher can catch; a sustained run is
    /// an opportunity nobody faster wants.
    pub longest_positive_run: u64,
    #[serde(skip)]
    current_run: u64,
}

impl RouteStats {
    fn record(&mut self, bps: i64) {
        if self.samples == 0 {
            self.best_bps = bps;
        } else if bps > self.best_bps {
            self.best_bps = bps;
        }
        self.samples += 1;
        if bps > 0 {
            self.positive_samples += 1;
            self.current_run += 1;
            if self.current_run > self.longest_positive_run {
                self.longest_positive_run = self.current_run;
            }
        } else {
            self.current_run = 0;
        }
    }
}

/// `getPair(address,address)`
const GET_PAIR_SELECTOR: &str = "e6a43905";
/// `getReserves()`
const GET_RESERVES: &str = "0x0902f1ac";

fn abi_address(addr: &str) -> String {
    format!("{:0>64}", addr.trim_start_matches("0x").to_ascii_lowercase())
}

/// Ask a factory for the pair address, returning `None` for the zero address.
pub async fn discover_pair(
    rpc: &BscRpcClient,
    factory: &str,
    token_a: &str,
    token_b: &str,
) -> Result<Option<String>> {
    let data = format!(
        "0x{GET_PAIR_SELECTOR}{}{}",
        abi_address(token_a),
        abi_address(token_b)
    );
    let raw = rpc.call_contract(factory, &data, "latest").await?;
    let trimmed = raw.trim_start_matches("0x");
    if trimmed.len() < 64 {
        bail!("getPair returned a short word");
    }
    let addr = format!("0x{}", &trimmed[24..64]);
    if addr == "0x0000000000000000000000000000000000000000" {
        return Ok(None);
    }
    Ok(Some(addr))
}

/// Build every ordered venue-to-venue route for tokens listed on 2+ venues.
pub async fn build_routes(rpc: &BscRpcClient, config: &SurveyConfig) -> Result<Vec<Route>> {
    let quote = normalize_address(&config.quote_token)?;
    let mut routes = Vec::new();
    for token in &config.tokens {
        let token = normalize_address(token)?;
        let token_is_reserve0 = token.as_str() < quote.as_str();
        let mut listed: Vec<(&Venue, String)> = Vec::new();
        for venue in &config.venues {
            normalize_address(&venue.factory)?;
            if let Some(pair) = discover_pair(rpc, &venue.factory, &token, &quote).await? {
                listed.push((venue, pair));
            }
        }
        if listed.len() < 2 {
            continue;
        }
        for (buy, buy_pair) in &listed {
            for (sell, sell_pair) in &listed {
                if buy.name == sell.name {
                    continue;
                }
                routes.push(Route {
                    token: token.clone(),
                    buy_venue: buy.name.clone(),
                    sell_venue: sell.name.clone(),
                    buy_pair: buy_pair.clone(),
                    sell_pair: sell_pair.clone(),
                    buy_fee_bps: buy.fee_bps,
                    sell_fee_bps: sell.fee_bps,
                    token_is_reserve0,
                });
            }
        }
    }
    Ok(routes)
}

/// Reserves oriented as (token, quote).
fn parse_oriented(raw: &str, token_is_reserve0: bool) -> Result<(u128, u128)> {
    let data = raw.trim_start_matches("0x");
    if data.len() < 128 {
        bail!("getReserves returned fewer than two words");
    }
    let r0 = parse_hex_u128(&format!("0x{}", &data[0..64]))?;
    let r1 = parse_hex_u128(&format!("0x{}", &data[64..128]))?;
    Ok(if token_is_reserve0 { (r0, r1) } else { (r1, r0) })
}

/// Price one route at the pinned block. Returns round-trip result in bps.
pub async fn price_route(rpc: &BscRpcClient, route: &Route, block: &str, probe_bps: u32) -> Result<i64> {
    let buy_raw = rpc.call_contract(&route.buy_pair, GET_RESERVES, block).await?;
    let sell_raw = rpc.call_contract(&route.sell_pair, GET_RESERVES, block).await?;
    let (buy_token, buy_quote) = parse_oriented(&buy_raw, route.token_is_reserve0)?;
    let (sell_token, sell_quote) = parse_oriented(&sell_raw, route.token_is_reserve0)?;

    // Spend the token, receive the quote, sell the quote back for the token.
    let legs = CycleLegs {
        buy_reserve_in: buy_token,
        buy_reserve_out: buy_quote,
        buy_fee_bps: route.buy_fee_bps,
        sell_reserve_in: sell_quote,
        sell_reserve_out: sell_token,
        sell_fee_bps: route.sell_fee_bps,
    };

    let probe = buy_token / 10_000 * probe_bps as u128;
    if probe == 0 {
        return Ok(i64::MIN);
    }
    let back = legs.round_trip_out(probe);
    // Signed, because a loss is the normal case and must be representable.
    let delta = back as i128 - probe as i128;
    Ok(((delta * 10_000) / probe as i128) as i64)
}

/// Format a report, best route first.
pub fn report(stats: &BTreeMap<String, RouteStats>) -> String {
    let mut rows: Vec<(&String, &RouteStats)> = stats.iter().collect();
    rows.sort_by(|a, b| {
        b.1.longest_positive_run
            .cmp(&a.1.longest_positive_run)
            .then(b.1.best_bps.cmp(&a.1.best_bps))
    });
    let mut out = String::from("route | best_bps | positive | longest_run | samples\n");
    for (key, s) in rows.iter().take(25) {
        out.push_str(&format!(
            "{} | {} | {} | {} | {}\n",
            key, s.best_bps, s.positive_samples, s.longest_positive_run, s.samples
        ));
    }
    out
}

/// Price every route from a single snapshot of reserves.
///
/// Reserves are fetched once per pair, not once per route. With 12 tokens on 3
/// venues there are 36 pairs but 72 directed routes; pricing each route
/// independently would double the RPC cost for identical data, and — worse —
/// could read the two legs of one route at different chain states.
fn price_from_snapshot(
    routes: &[Route],
    reserves: &BTreeMap<String, (u128, u128)>,
    probe_bps: u32,
    min_quote_reserve: u128,
    min_abs_profit: u128,
) -> Vec<(String, i64)> {
    let mut out = Vec::with_capacity(routes.len());
    for route in routes {
        let (Some(&(buy_token, buy_quote)), Some(&(sell_token, sell_quote))) =
            (reserves.get(&route.buy_pair), reserves.get(&route.sell_pair))
        else {
            continue;
        };
        // Both legs must be deep enough to matter. Skipping outright rather
        // than recording a negative keeps dust pools out of the sample entirely.
        if buy_quote < min_quote_reserve || sell_quote < min_quote_reserve {
            continue;
        }
        let legs = CycleLegs {
            buy_reserve_in: buy_token,
            buy_reserve_out: buy_quote,
            buy_fee_bps: route.buy_fee_bps,
            sell_reserve_in: sell_quote,
            sell_reserve_out: sell_token,
            sell_fee_bps: route.sell_fee_bps,
        };
        let probe = buy_token / 10_000 * probe_bps as u128;
        if probe == 0 {
            continue;
        }
        let back = legs.round_trip_out(probe);
        let delta = back as i128 - probe as i128;
        // A gain too small to clear gas is not an opportunity, whatever its bps.
        // Report it as non-positive so it cannot accumulate a persistence run.
        let bps = if delta > 0 && (delta as u128) < min_abs_profit {
            0
        } else {
            ((delta * 10_000) / probe as i128) as i64
        };
        out.push((route.key(), bps));
    }
    out
}

/// Run the survey until the process stops.
///
/// Observation only: no signer, no relay, no execution path is reachable from
/// here. The output is a persistence report on stdout.
pub async fn run_survey(rpc: BscRpcClient) -> Result<()> {
    let Some(config) = load_config()? else {
        tracing::info!("survey is disabled or unconfigured; no routes will be measured");
        return Ok(());
    };

    let routes = build_routes(&rpc, &config).await?;
    if routes.is_empty() {
        tracing::warn!("survey found no token listed on two or more venues");
        return Ok(());
    }
    let mut unique_pairs: Vec<String> = routes
        .iter()
        .flat_map(|r| [r.buy_pair.clone(), r.sell_pair.clone()])
        .collect();
    unique_pairs.sort();
    unique_pairs.dedup();
    let orientation: BTreeMap<String, bool> = routes
        .iter()
        .flat_map(|r| {
            [
                (r.buy_pair.clone(), r.token_is_reserve0),
                (r.sell_pair.clone(), r.token_is_reserve0),
            ]
        })
        .collect();

    let sample_every = match config.mode {
        SurveyMode::Focused => 1,
        SurveyMode::Wide => config.sample_every_n_blocks.max(1),
    };
    tracing::info!(
        routes = routes.len(),
        pairs = unique_pairs.len(),
        mode = ?config.mode,
        sample_every_n_blocks = sample_every,
        "survey starting"
    );

    let min_quote_reserve: u128 = config
        .min_quote_reserve_wei
        .parse()
        .context("minQuoteReserveWei is not a valid integer")?;
    let min_abs_profit: u128 = config
        .min_abs_profit_wei
        .parse()
        .context("minAbsProfitWei is not a valid integer")?;
    tracing::info!(%min_quote_reserve, %min_abs_profit, "survey liquidity floors");

    let mut stats: BTreeMap<String, RouteStats> = BTreeMap::new();
    let mut last_block = 0_u64;
    let mut samples_taken = 0_u64;

    loop {
        let head = match rpc.latest_block().await {
            Ok(block) => block,
            Err(error) => {
                tracing::warn!(%error, "survey could not read the chain head");
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                continue;
            }
        };
        let block_number = crate::rpc::parse_hex_u64(&head.number)?;
        if last_block != 0 && block_number < last_block + sample_every {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            continue;
        }
        last_block = block_number;

        // Pin every read to one block so the two legs of a route can never be
        // priced against different chain states.
        let block_tag = format!("0x{block_number:x}");
        let mut reserves = BTreeMap::new();
        for pair in &unique_pairs {
            match rpc.call_contract(pair, GET_RESERVES, &block_tag).await {
                Ok(raw) => {
                    let token_is_reserve0 = orientation.get(pair).copied().unwrap_or(true);
                    if let Ok(oriented) = parse_oriented(&raw, token_is_reserve0) {
                        reserves.insert(pair.clone(), oriented);
                    }
                }
                Err(error) => tracing::debug!(%error, %pair, "reserve read failed"),
            }
        }

        for (key, bps) in price_from_snapshot(
            &routes,
            &reserves,
            config.probe_bps,
            min_quote_reserve,
            min_abs_profit,
        ) {
            stats.entry(key).or_default().record(bps);
        }
        samples_taken += 1;

        // Report periodically rather than every sample; the interesting signal
        // is accumulated persistence, not any single reading.
        if samples_taken % 20 == 0 {
            // One structured line per record, never a multi-line block. Cloud
            // Logging splits stdout on newlines, so an embedded report is torn
            // into separate entries and its fields are orphaned onto the last
            // fragment — the record becomes unqueryable and effectively lost.
            let ever_positive = stats.values().filter(|s| s.positive_samples > 0).count();
            let best = stats
                .iter()
                .max_by_key(|(_, s)| (s.longest_positive_run, s.best_bps));
            tracing::info!(
                block_number,
                samples_taken,
                routes_total = stats.len(),
                routes_ever_positive = ever_positive,
                best_route = best.map(|(k, _)| k.as_str()).unwrap_or("-"),
                best_run = best.map(|(_, s)| s.longest_positive_run).unwrap_or(0),
                best_bps = best.map(|(_, s)| s.best_bps).unwrap_or(0),
                "survey summary"
            );

            // Detail lines for what actually matters: anything that ever cleared
            // the fee floor, else the closest few so the margin is visible.
            let mut rows: Vec<(&String, &RouteStats)> = stats.iter().collect();
            rows.sort_by(|a, b| {
                b.1.longest_positive_run
                    .cmp(&a.1.longest_positive_run)
                    .then(b.1.best_bps.cmp(&a.1.best_bps))
            });
            for (key, s) in rows.iter().take(8) {
                tracing::info!(
                    route = key.as_str(),
                    best_bps = s.best_bps,
                    positive_samples = s.positive_samples,
                    longest_positive_run = s.longest_positive_run,
                    samples = s.samples,
                    "survey route"
                );
            }
        }
    }
}

pub fn load_config() -> Result<Option<SurveyConfig>> {
    let Ok(raw) = std::env::var("MEV_SURVEY_CONFIG_JSON") else {
        return Ok(None);
    };
    let config: SurveyConfig =
        serde_json::from_str(&raw).context("MEV_SURVEY_CONFIG_JSON is not valid JSON")?;
    if !config.enabled {
        return Ok(None);
    }
    if config.venues.len() < 2 {
        bail!("a survey needs at least two venues to compare");
    }
    Ok(Some(config))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dust_route() -> Route {
        Route { token: "0xaa".into(), buy_venue: "PCS".into(), sell_venue: "BSW".into(),
            buy_pair: "0xp1".into(), sell_pair: "0xp2".into(),
            buy_fee_bps: 25, sell_fee_bps: 20, token_is_reserve0: true }
    }

    /// The first live run flagged four routes positive on 20/20 samples, topped
    /// by +115 bps. Every one ran through an abandoned pool — $10, $250, $450 of
    /// liquidity. They persisted *because* nobody arbitrages ten dollars. Without
    /// a depth floor, the persistence metric selects for irrelevance.
    #[test]
    fn dust_pools_are_excluded_entirely() {
        let routes = vec![dust_route()];
        let mut reserves = BTreeMap::new();
        // ~0.0088 WBNB — the real ALPACA/Biswap pool that produced +115 bps.
        reserves.insert("0xp1".to_string(), (9_165_000_000_000_000_000_000_u128, 8_800_000_000_000_000_u128));
        reserves.insert("0xp2".to_string(), (9_367_469_000_000_000_000_000_000_u128, 8_862_100_000_000_000_000_u128));
        let floor = 50_000_000_000_000_000_000_u128; // 50 WBNB
        let priced = price_from_snapshot(&routes, &reserves, 5, floor, 0);
        assert!(priced.is_empty(), "a dust leg must be skipped, not scored");
    }

    /// A bps gain too small to clear gas must not accumulate a persistence run.
    #[test]
    fn sub_gas_gains_do_not_count_as_positive() {
        let routes = vec![dust_route()];
        let mut reserves = BTreeMap::new();
        let deep = 1_000_000_000_000_000_000_000_u128; // 1000 WBNB, passes the floor
        reserves.insert("0xp1".to_string(), (2_000_000_000_000_000_000_000_000_u128, deep));
        reserves.insert("0xp2".to_string(), (2_000_000_000_000_000_000_000_000_u128, deep));
        // An impossibly high absolute floor forces any gain to be discounted.
        let priced = price_from_snapshot(&routes, &reserves, 5, 0, u128::MAX);
        for (_, bps) in priced {
            assert!(bps <= 0, "a gain below the gas floor must not read positive");
        }
    }

    #[test]
    fn persistence_run_tracks_the_longest_unbroken_streak() {
        let mut s = RouteStats::default();
        for bps in [-5, 3, 7, -1, 2, 4, 6, -9] {
            s.record(bps);
        }
        assert_eq!(s.samples, 8);
        assert_eq!(s.positive_samples, 5);
        assert_eq!(s.best_bps, 7);
        // Runs are 2 then 3; the longer one is what matters.
        assert_eq!(s.longest_positive_run, 3);
    }

    /// A single positive sample is a blink, not an opportunity. It must be
    /// distinguishable from a sustained dislocation, because only the latter is
    /// reachable by a system that arrives a block late.
    #[test]
    fn isolated_spikes_do_not_look_like_persistence() {
        let mut spike = RouteStats::default();
        for bps in [-4, 9, -4, 8, -4, 7, -4] {
            spike.record(bps);
        }
        let mut sustained = RouteStats::default();
        for bps in [-4, 2, 2, 2, 2, -4, -4] {
            sustained.record(bps);
        }
        assert_eq!(spike.positive_samples, 3);
        assert_eq!(spike.longest_positive_run, 1);
        assert_eq!(sustained.positive_samples, 4);
        assert_eq!(sustained.longest_positive_run, 4);
        assert!(
            sustained.longest_positive_run > spike.longest_positive_run,
            "sustained dislocation must rank above a higher-amplitude blink"
        );
    }

    #[test]
    fn best_bps_is_seeded_from_the_first_sample_not_zero() {
        // Every sample negative: best must be the least-bad, not a default 0.
        let mut s = RouteStats::default();
        for bps in [-40, -12, -30] {
            s.record(bps);
        }
        assert_eq!(s.best_bps, -12);
        assert_eq!(s.positive_samples, 0);
        assert_eq!(s.longest_positive_run, 0);
    }

    #[test]
    fn report_orders_by_persistence_then_amplitude() {
        let mut stats = BTreeMap::new();
        let mut blink = RouteStats::default();
        blink.record(50);
        blink.record(-1);
        let mut steady = RouteStats::default();
        for _ in 0..4 {
            steady.record(3);
        }
        stats.insert("BLINK PCS->BSW".to_string(), blink);
        stats.insert("STEADY PCS->APE".to_string(), steady);
        let text = report(&stats);
        let steady_at = text.find("STEADY").unwrap();
        let blink_at = text.find("BLINK").unwrap();
        assert!(steady_at < blink_at, "persistence must outrank amplitude");
    }
}
