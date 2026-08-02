use crate::kernel::mev_wilson_lower_bound;
use crate::model::{
    DemotionEvaluation, DemotionPolicy, DemotionRequest, ExecutionMode, GateResult,
    PromotionEvaluation, PromotionPolicy, PromotionRequest,
};
use chrono::Utc;
use std::collections::BTreeMap;

/// One-sided 95% critical value, in parts per million.
const WILSON_Z_PPM: u32 = 1_644_854;

fn wilson_lower_ppm(profitable_count: u64, sample_count: u64) -> u32 {
    // SAFETY: `mev_wilson_lower_bound` is a pure arithmetic function in the C++
    // kernel. It reads no pointers and has no interior state; the only inputs
    // are three integers passed by value.
    let wilson = unsafe { mev_wilson_lower_bound(profitable_count, sample_count, WILSON_Z_PPM) };
    (wilson.clamp(0.0, 1.0) * 1_000_000.0).round() as u32
}

fn minimum(actual: u64, required: u64) -> GateResult {
    GateResult {
        passed: actual >= required,
        actual: actual.to_string(),
        required: format!(">={required}"),
    }
}

fn maximum(actual: u64, required: u64) -> GateResult {
    GateResult {
        passed: actual <= required,
        actual: actual.to_string(),
        required: format!("<={required}"),
    }
}

pub fn evaluate_promotion(request: &PromotionRequest) -> PromotionEvaluation {
    let policy: PromotionPolicy = request.policy.clone().unwrap_or_default();
    let evidence = &request.evidence;
    let wilson_lower_ppm = wilson_lower_ppm(evidence.profitable_count, evidence.sample_count);

    let mut gates = BTreeMap::new();
    gates.insert(
        "calibratedProbability".to_string(),
        minimum(
            evidence.calibrated_probability_ppm as u64,
            policy.min_probability_ppm as u64,
        ),
    );
    gates.insert(
        "wilsonLowerBound".to_string(),
        minimum(wilson_lower_ppm as u64, policy.min_wilson_lower_ppm as u64),
    );
    gates.insert(
        "sampleCount".to_string(),
        minimum(evidence.sample_count, policy.min_sample_count),
    );
    gates.insert(
        "brierLoss".to_string(),
        maximum(
            evidence.brier_loss_ppm as u64,
            policy.max_brier_loss_ppm as u64,
        ),
    );
    gates.insert(
        "expectedCalibrationError".to_string(),
        maximum(
            evidence.expected_calibration_error_ppm as u64,
            policy.max_expected_calibration_error_ppm as u64,
        ),
    );
    gates.insert(
        "profitFactor".to_string(),
        minimum(
            evidence.profit_factor_ppm as u64,
            policy.min_profit_factor_ppm as u64,
        ),
    );
    gates.insert(
        "maxDrawdown".to_string(),
        maximum(
            evidence.max_drawdown_bps as u64,
            policy.max_drawdown_bps as u64,
        ),
    );
    gates.insert(
        "dataIntegrity".to_string(),
        GateResult {
            passed: evidence.data_integrity_passed,
            actual: evidence.data_integrity_passed.to_string(),
            required: "true".to_string(),
        },
    );
    gates.insert(
        "executionReadiness".to_string(),
        GateResult {
            passed: evidence.execution_readiness_passed,
            actual: evidence.execution_readiness_passed.to_string(),
            required: "true".to_string(),
        },
    );
    gates.insert(
        "canaryEvidenceFailures".to_string(),
        maximum(evidence.canary_evidence_failures as u64, 0),
    );

    let base_passed = gates.values().all(|gate| gate.passed);
    let finalized_canary_gate = minimum(
        evidence.finalized_canary_executions as u64,
        policy.min_finalized_canary_executions as u64,
    );
    let canary_scale_passed = finalized_canary_gate.passed;
    gates.insert("finalizedCanaryExecutions".to_string(), finalized_canary_gate);
    let target_mode = match request.current_mode {
        ExecutionMode::Simulation if base_passed => ExecutionMode::CanaryLive,
        ExecutionMode::CanaryLive
            if base_passed
                && canary_scale_passed =>
        {
            ExecutionMode::Live
        }
        ExecutionMode::Paused => ExecutionMode::Paused,
        mode => mode,
    };

    PromotionEvaluation {
        previous_mode: request.current_mode,
        target_mode,
        promoted: target_mode != request.current_mode,
        wilson_lower_ppm,
        evaluated_at: Utc::now(),
        gates,
    }
}

/// Pull a live strategy back to `Paused` when its evidence degrades.
///
/// Counterpart to [`evaluate_promotion`], which can only move a strategy up.
/// Without this, a model that decays *after* promotion keeps trading on the
/// strength of evidence it no longer has — the failure mode where a system
/// looks healthiest right up until it isn't.
///
/// Only `CanaryLive` and `Live` are demotable: `Simulation` has nothing to fall
/// back to, and `Paused` is already terminal.
pub fn evaluate_demotion(request: &DemotionRequest) -> DemotionEvaluation {
    let policy: DemotionPolicy = request.policy.clone().unwrap_or_default();
    let evidence = &request.evidence;
    let wilson_lower = wilson_lower_ppm(evidence.profitable_count, evidence.sample_count);

    let mut gates = BTreeMap::new();
    gates.insert(
        "wilsonLowerBound".to_string(),
        minimum(wilson_lower as u64, policy.min_wilson_lower_ppm as u64),
    );
    gates.insert(
        "calibratedProbability".to_string(),
        minimum(
            evidence.calibrated_probability_ppm as u64,
            policy.min_probability_ppm as u64,
        ),
    );
    gates.insert(
        "brierLoss".to_string(),
        maximum(
            evidence.brier_loss_ppm as u64,
            policy.max_brier_loss_ppm as u64,
        ),
    );
    gates.insert(
        "expectedCalibrationError".to_string(),
        maximum(
            evidence.expected_calibration_error_ppm as u64,
            policy.max_expected_calibration_error_ppm as u64,
        ),
    );
    gates.insert(
        "profitFactor".to_string(),
        minimum(
            evidence.profit_factor_ppm as u64,
            policy.min_profit_factor_ppm as u64,
        ),
    );
    gates.insert(
        "maxDrawdown".to_string(),
        maximum(evidence.max_drawdown_bps as u64, policy.max_drawdown_bps as u64),
    );
    gates.insert(
        "dataIntegrity".to_string(),
        GateResult {
            passed: evidence.data_integrity_passed,
            actual: evidence.data_integrity_passed.to_string(),
            required: "true".to_string(),
        },
    );
    // Any evidence failure during live execution is disqualifying on its own.
    // A trade we cannot prove the outcome of is worse than a losing trade,
    // because it silently corrupts every statistic computed downstream.
    gates.insert(
        "canaryEvidenceFailures".to_string(),
        maximum(evidence.canary_evidence_failures as u64, 0),
    );

    let breaches: BTreeMap<String, GateResult> = gates
        .into_iter()
        .filter(|(_, gate)| !gate.passed)
        .collect();

    let demotable = matches!(
        request.current_mode,
        ExecutionMode::CanaryLive | ExecutionMode::Live
    );
    let target_mode = if demotable && !breaches.is_empty() {
        ExecutionMode::Paused
    } else {
        request.current_mode
    };

    DemotionEvaluation {
        previous_mode: request.current_mode,
        target_mode,
        demoted: target_mode != request.current_mode,
        wilson_lower_ppm: wilson_lower,
        evaluated_at: Utc::now(),
        breaches,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::EvidenceWindow;

    fn passing_evidence() -> EvidenceWindow {
        EvidenceWindow {
            model_version: "test".to_string(),
            sample_count: 200,
            profitable_count: 190,
            calibrated_probability_ppm: 930_000,
            brier_loss_ppm: 60_000,
            expected_calibration_error_ppm: 20_000,
            profit_factor_ppm: 1_800_000,
            max_drawdown_bps: 200,
            data_integrity_passed: true,
            execution_readiness_passed: true,
            finalized_canary_executions: 0,
            canary_evidence_failures: 0,
        }
    }

    #[test]
    fn promotes_strong_simulation_to_mainnet_canary() {
        let result = evaluate_promotion(&PromotionRequest {
            current_mode: ExecutionMode::Simulation,
            evidence: passing_evidence(),
            policy: None,
        });
        assert_eq!(result.target_mode, ExecutionMode::CanaryLive);
        assert!(result.promoted);
        assert!(result.wilson_lower_ppm > 900_000);
    }

    #[test]
    fn observed_eighty_five_percent_is_not_enough() {
        let mut evidence = passing_evidence();
        evidence.profitable_count = 170;
        let result = evaluate_promotion(&PromotionRequest {
            current_mode: ExecutionMode::Simulation,
            evidence,
            policy: None,
        });
        assert_eq!(result.target_mode, ExecutionMode::Simulation);
        assert!(!result.gates["wilsonLowerBound"].passed);
    }

    #[test]
    fn deployment_readiness_is_required_for_mainnet_canary() {
        let mut evidence = passing_evidence();
        evidence.execution_readiness_passed = false;
        let result = evaluate_promotion(&PromotionRequest {
            current_mode: ExecutionMode::Simulation,
            evidence,
            policy: None,
        });
        assert_eq!(result.target_mode, ExecutionMode::Simulation);
        assert!(!result.gates["executionReadiness"].passed);
    }

    #[test]
    fn any_canary_evidence_failure_prevents_scaling() {
        let mut evidence = passing_evidence();
        evidence.finalized_canary_executions = 20;
        evidence.canary_evidence_failures = 1;
        let result = evaluate_promotion(&PromotionRequest {
            current_mode: ExecutionMode::CanaryLive,
            evidence,
            policy: None,
        });
        assert_eq!(result.target_mode, ExecutionMode::CanaryLive);
    }

    /// The worker must never emit the two execution-owned counters.
    ///
    /// `run_replay` always builds them as 0 because it cannot observe them. When
    /// they were serialized, the control plane wrote those zeros into the
    /// strategy document on every observation — and since an observation
    /// immediately precedes every execution, `finalizedCanaryExecutions`
    /// oscillated 0 -> 1 -> 0 and could never reach the 20 required to promote
    /// CANARY_LIVE -> LIVE. The gate was structurally unreachable.
    ///
    /// They must still deserialize, because promotion evaluation reads them.
    #[test]
    fn evidence_accepts_execution_counters_but_never_emits_them() {
        let mut evidence = passing_evidence();
        evidence.finalized_canary_executions = 20;
        evidence.canary_evidence_failures = 3;

        let encoded = serde_json::to_value(&evidence).expect("serializes");
        assert!(
            encoded.get("finalizedCanaryExecutions").is_none(),
            "replay must not overwrite execution-owned progress"
        );
        assert!(
            encoded.get("canaryEvidenceFailures").is_none(),
            "replay must not overwrite execution-owned failure history"
        );
        // Everything replay genuinely owns is still reported.
        assert!(encoded.get("sampleCount").is_some());
        assert!(encoded.get("calibratedProbabilityPpm").is_some());

        let mut inbound = encoded.clone();
        inbound["finalizedCanaryExecutions"] = serde_json::json!(20);
        inbound["canaryEvidenceFailures"] = serde_json::json!(3);
        let decoded: EvidenceWindow = serde_json::from_value(inbound).expect("deserializes");
        assert_eq!(decoded.finalized_canary_executions, 20);
        assert_eq!(decoded.canary_evidence_failures, 3);
    }

    /// With the counters supplied by the control plane, the LIVE gate is
    /// reachable — the property the serialization bug silently removed.
    #[test]
    fn canary_live_can_reach_live_once_counters_survive() {
        let mut evidence = passing_evidence();
        evidence.finalized_canary_executions = 20;
        let result = evaluate_promotion(&PromotionRequest {
            current_mode: ExecutionMode::CanaryLive,
            evidence,
            policy: None,
        });
        assert_eq!(result.target_mode, ExecutionMode::Live);
        assert!(result.promoted);
    }

    fn demotion_request(mode: ExecutionMode, evidence: EvidenceWindow) -> DemotionRequest {
        DemotionRequest {
            current_mode: mode,
            evidence,
            policy: None,
        }
    }

    #[test]
    fn healthy_live_evidence_is_not_demoted() {
        let result = evaluate_demotion(&demotion_request(
            ExecutionMode::Live,
            passing_evidence(),
        ));
        assert_eq!(result.target_mode, ExecutionMode::Live);
        assert!(!result.demoted);
        assert!(result.breaches.is_empty());
    }

    #[test]
    fn collapsed_win_rate_demotes_live_to_paused() {
        let mut evidence = passing_evidence();
        evidence.profitable_count = 160; // 80% observed -> Wilson lower ~0.75
        let result = evaluate_demotion(&demotion_request(ExecutionMode::Live, evidence));
        assert_eq!(result.target_mode, ExecutionMode::Paused);
        assert!(result.demoted);
        assert!(result.breaches.contains_key("wilsonLowerBound"));
    }

    /// The dead band that stops the system oscillating. 170/200 fails the
    /// promotion floor (proven by `observed_eighty_five_percent_is_not_enough`)
    /// but sits above the demotion floor, so an already-live strategy holds
    /// position instead of flapping Live -> Paused -> Live on sampling noise.
    #[test]
    fn hysteresis_band_holds_position_between_the_floors() {
        let mut evidence = passing_evidence();
        evidence.profitable_count = 170;

        let promotion = evaluate_promotion(&PromotionRequest {
            current_mode: ExecutionMode::Simulation,
            evidence: evidence.clone(),
            policy: None,
        });
        assert!(!promotion.gates["wilsonLowerBound"].passed);

        let demotion = evaluate_demotion(&demotion_request(ExecutionMode::Live, evidence));
        assert_eq!(demotion.target_mode, ExecutionMode::Live);
        assert!(!demotion.demoted);
    }

    #[test]
    fn data_integrity_failure_demotes_immediately() {
        let mut evidence = passing_evidence();
        evidence.data_integrity_passed = false;
        let result = evaluate_demotion(&demotion_request(ExecutionMode::CanaryLive, evidence));
        assert_eq!(result.target_mode, ExecutionMode::Paused);
        assert!(result.breaches.contains_key("dataIntegrity"));
    }

    #[test]
    fn a_single_canary_evidence_failure_demotes() {
        let mut evidence = passing_evidence();
        evidence.canary_evidence_failures = 1;
        let result = evaluate_demotion(&demotion_request(ExecutionMode::Live, evidence));
        assert_eq!(result.target_mode, ExecutionMode::Paused);
        assert!(result.breaches.contains_key("canaryEvidenceFailures"));
    }

    /// Simulation has nothing to fall back to; demotion must be a no-op there
    /// rather than parking a paper strategy in Paused and stalling evidence
    /// collection.
    #[test]
    fn simulation_is_never_demoted() {
        let mut evidence = passing_evidence();
        evidence.profitable_count = 10;
        evidence.data_integrity_passed = false;
        let result = evaluate_demotion(&demotion_request(ExecutionMode::Simulation, evidence));
        assert_eq!(result.target_mode, ExecutionMode::Simulation);
        assert!(!result.demoted);
    }
}
