use crate::model::{EvidenceWindow, ReplayRequest, ReplayResult};
use anyhow::{bail, Result};
use std::collections::HashSet;

pub fn run_replay(request: &ReplayRequest) -> Result<ReplayResult> {
    if request.starting_capital_usd_micros <= 0 {
        bail!("startingCapitalUsdMicros must be positive");
    }
    if request.records.is_empty() {
        bail!("at least one replay record is required");
    }

    let mut seen = HashSet::new();
    let mut duplicate_observation_ids = 0_u64;
    let mut time_order_violations = 0_u64;
    let mut previous_time = None;
    let mut accepted = Vec::new();
    let mut rejected_records = 0_u64;

    for record in &request.records {
        if !seen.insert(record.opportunity.observation_id.clone()) {
            duplicate_observation_ids += 1;
            rejected_records += 1;
            continue;
        }
        if previous_time
            .map(|value| record.opportunity.observed_at <= value)
            .unwrap_or(false)
        {
            time_order_violations += 1;
            rejected_records += 1;
            continue;
        }
        previous_time = Some(record.opportunity.observed_at);
        if !record.opportunity.simulation.success
            || record.opportunity.features.gross_profit_usd_micros < 0
            || record.opportunity.features.gas_usd_micros < 0
            || record.opportunity.features.relay_usd_micros < 0
            || record.opportunity.features.slippage_usd_micros < 0
        {
            rejected_records += 1;
            continue;
        }
        accepted.push(record);
    }

    let sample_count = accepted.len() as u64;
    if sample_count == 0 {
        bail!("no valid replay records remain after data-integrity checks");
    }
    let profitable_count = accepted
        .iter()
        .filter(|record| record.realized_net_profit_usd_micros > 0)
        .count() as u64;

    let mut squared_error = 0.0_f64;
    let mut bins = [(0_u64, 0.0_f64, 0_u64); 10];
    let mut gross_profit = 0_i128;
    let mut gross_loss = 0_i128;
    let mut equity = request.starting_capital_usd_micros as i128;
    let mut peak = equity;
    let mut max_drawdown_bps = 0_u32;

    for record in &accepted {
        let probability =
            record.opportunity.features.calibrated_probability_ppm as f64 / 1_000_000.0;
        let outcome = f64::from(record.realized_net_profit_usd_micros > 0);
        squared_error += (probability - outcome).powi(2);
        let bin = ((record.opportunity.features.calibrated_probability_ppm as usize) / 100_000)
            .min(9);
        bins[bin].0 += 1;
        bins[bin].1 += probability;
        bins[bin].2 += u64::from(record.realized_net_profit_usd_micros > 0);

        let pnl = record.realized_net_profit_usd_micros as i128;
        if pnl > 0 {
            gross_profit += pnl;
        } else {
            gross_loss += -pnl;
        }
        equity += pnl;
        peak = peak.max(equity);
        if peak > 0 && equity < peak {
            let drawdown = (((peak - equity) * 10_000) / peak).clamp(0, u32::MAX as i128);
            max_drawdown_bps = max_drawdown_bps.max(drawdown as u32);
        }
    }

    let mut ece = 0.0_f64;
    for (count, probability_sum, positive_count) in bins {
        if count == 0 {
            continue;
        }
        let weight = count as f64 / sample_count as f64;
        let mean_probability = probability_sum / count as f64;
        let actual_rate = positive_count as f64 / count as f64;
        ece += weight * (mean_probability - actual_rate).abs();
    }
    let brier_loss_ppm = ((squared_error / sample_count as f64) * 1_000_000.0)
        .round()
        .clamp(0.0, u32::MAX as f64) as u32;
    let expected_calibration_error_ppm = (ece * 1_000_000.0)
        .round()
        .clamp(0.0, u32::MAX as f64) as u32;
    let profit_factor_ppm = if gross_loss == 0 {
        if gross_profit > 0 { u32::MAX } else { 0 }
    } else {
        ((gross_profit * 1_000_000) / gross_loss).clamp(0, u32::MAX as i128) as u32
    };

    Ok(ReplayResult {
        evidence: EvidenceWindow {
            model_version: request.model_version.clone(),
            sample_count,
            profitable_count,
            calibrated_probability_ppm: accepted
                .last()
                .expect("accepted is non-empty")
                .opportunity
                .features
                .calibrated_probability_ppm,
            brier_loss_ppm,
            expected_calibration_error_ppm,
            profit_factor_ppm,
            max_drawdown_bps,
            data_integrity_passed: duplicate_observation_ids == 0
                && time_order_violations == 0
                && rejected_records == 0,
            execution_readiness_passed: false,
            finalized_canary_executions: 0,
            canary_evidence_failures: 0,
        },
        accepted_records: sample_count,
        rejected_records,
        duplicate_observation_ids,
        time_order_violations,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Opportunity, OpportunityFeatures, ReplayRecord, SimulationProof};
    use chrono::{TimeZone, Utc};

    #[test]
    fn replay_metrics_are_derived_from_outcomes() {
        let records = (0..200)
            .map(|index| ReplayRecord {
                opportunity: Opportunity {
                    observation_id: format!("id-{index}"),
                    observed_at: Utc.timestamp_opt(1_700_000_000 + index, 0).unwrap(),
                    strategy: "atomic_v2_arbitrage".to_string(),
                    features: OpportunityFeatures {
                        gross_profit_usd_micros: 100_000,
                        gas_usd_micros: 10_000,
                        relay_usd_micros: 1_000,
                        slippage_usd_micros: 2_000,
                        notional_usd_micros: 1_000_000,
                        available_liquidity_usd_micros: 1_000_000_000,
                        calibrated_probability_ppm: 950_000,
                        data_age_ms: 10,
                        estimated_latency_ms: 20,
                    },
                    simulation: SimulationProof {
                        success: true,
                        state_block: index as u64,
                        state_block_hash: format!("0x{index:064x}"),
                        call_result_hash: format!("0x{:064x}", index + 1),
                        protected_route: true,
                    },
                },
                realized_net_profit_usd_micros: if index < 190 { 80_000 } else { -100_000 },
            })
            .collect();
        let result = run_replay(&ReplayRequest {
            model_version: "test".to_string(),
            starting_capital_usd_micros: 10_000_000,
            records,
        })
        .unwrap();
        assert_eq!(result.evidence.sample_count, 200);
        assert_eq!(result.evidence.profitable_count, 190);
        assert_eq!(result.evidence.expected_calibration_error_ppm, 0);
        assert!(result.evidence.data_integrity_passed);
    }
}
