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
) -> Vec<(String, i64)> {
    let mut out = Vec::with_capacity(routes.len());
    for route in routes {
        let (Some(&(buy_token, buy_quote)), Some(&(sell_token, sell_quote))) =
            (reserves.get(&route.buy_pair), reserves.get(&route.sell_pair))
        else {
            continue;
        };
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
        out.push((route.key(), ((delta * 10_000) / probe as i128) as i64));
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

        for (key, bps) in price_from_snapshot(&routes, &reserves, config.probe_bps) {
            stats.entry(key).or_default().record(bps);
        }
        samples_taken += 1;

        // Report periodically rather than every sample; the interesting signal
        // is accumulated persistence, not any single reading.
        if samples_taken % 20 == 0 {
            let positive: Vec<&String> = stats
                .iter()
                .filter(|(_, s)| s.positive_samples > 0)
                .map(|(k, _)| k)
                .collect();
            tracing::info!(
                block_number,
                samples_taken,
                routes_ever_positive = positive.len(),
                "survey progress\n{}",
                report(&stats)
            );
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
