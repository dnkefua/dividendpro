use crate::kernel::mev_wilson_lower_bound;
use crate::model::{
    ExecutionMode, GateResult, PromotionEvaluation, PromotionPolicy, PromotionRequest,
};
use chrono::Utc;
use std::collections::BTreeMap;

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
    let wilson = unsafe {
        mev_wilson_lower_bound(evidence.profitable_count, evidence.sample_count, 1_644_854)
    };
    let wilson_lower_ppm = (wilson.clamp(0.0, 1.0) * 1_000_000.0).round() as u32;

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
}
