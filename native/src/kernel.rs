use crate::model::{KernelDecision, Opportunity, RiskLimits};

const REJECTION_REASONS: &[(u32, &str)] = &[
    (1 << 0, "SIMULATION_FAILED"),
    (1 << 1, "STALE_DATA"),
    (1 << 2, "PUBLIC_ROUTE"),
    (1 << 3, "INSUFFICIENT_LIQUIDITY"),
    (1 << 4, "PROBABILITY_BELOW_GATE"),
    (1 << 5, "NON_POSITIVE_NET_PROFIT"),
    (1 << 6, "LATENCY_LIMIT"),
    (1 << 7, "NOTIONAL_LIMIT"),
    (1 << 8, "INTEGER_OVERFLOW_OR_INVALID_COST"),
];

#[repr(C)]
struct MevOpportunityInput {
    gross_profit_usd_micros: i64,
    gas_usd_micros: i64,
    relay_usd_micros: i64,
    slippage_usd_micros: i64,
    notional_usd_micros: i64,
    available_liquidity_usd_micros: i64,
    calibrated_probability_ppm: u32,
    data_age_ms: u32,
    estimated_latency_ms: u32,
    simulation_succeeded: u8,
    protected_route: u8,
    reserved: [u8; 6],
}

#[repr(C)]
struct MevRiskLimits {
    max_notional_usd_micros: i64,
    min_liquidity_usd_micros: i64,
    min_probability_ppm: u32,
    max_data_age_ms: u32,
    max_estimated_latency_ms: u32,
    require_protected_route: u8,
    reserved: [u8; 7],
}

#[repr(C)]
#[derive(Default)]
struct MevOpportunityOutput {
    expected_net_profit_usd_micros: i64,
    rejection_flags: u32,
    eligible: u8,
    reserved: [u8; 3],
}

extern "C" {
    fn mev_evaluate_opportunity(
        input: *const MevOpportunityInput,
        limits: *const MevRiskLimits,
        output: *mut MevOpportunityOutput,
    ) -> i32;
    pub(crate) fn mev_wilson_lower_bound(successes: u64, trials: u64, z_ppm: u32) -> f64;
}

pub fn evaluate_opportunity(opportunity: &Opportunity, limits: &RiskLimits) -> KernelDecision {
    let features = &opportunity.features;
    let input = MevOpportunityInput {
        gross_profit_usd_micros: features.gross_profit_usd_micros,
        gas_usd_micros: features.gas_usd_micros,
        relay_usd_micros: features.relay_usd_micros,
        slippage_usd_micros: features.slippage_usd_micros,
        notional_usd_micros: features.notional_usd_micros,
        available_liquidity_usd_micros: features.available_liquidity_usd_micros,
        calibrated_probability_ppm: features.calibrated_probability_ppm,
        data_age_ms: features.data_age_ms,
        estimated_latency_ms: features.estimated_latency_ms,
        simulation_succeeded: u8::from(opportunity.simulation.success),
        protected_route: u8::from(opportunity.simulation.protected_route),
        reserved: [0; 6],
    };
    let native_limits = MevRiskLimits {
        max_notional_usd_micros: limits.max_notional_usd_micros,
        min_liquidity_usd_micros: limits.min_liquidity_usd_micros,
        min_probability_ppm: limits.min_probability_ppm,
        max_data_age_ms: limits.max_data_age_ms,
        max_estimated_latency_ms: limits.max_estimated_latency_ms,
        require_protected_route: u8::from(limits.require_protected_route),
        reserved: [0; 7],
    };
    let mut output = MevOpportunityOutput::default();
    // The function is linked from the bundled C++ kernel and all pointers refer
    // to live stack values with matching #[repr(C)] layouts.
    let status = unsafe { mev_evaluate_opportunity(&input, &native_limits, &mut output) };
    if status != 0 {
        return KernelDecision {
            eligible: false,
            expected_net_profit_usd_micros: 0,
            rejection_flags: u32::MAX,
            rejection_reasons: vec!["KERNEL_ERROR".to_string()],
        };
    }
    KernelDecision {
        eligible: output.eligible == 1,
        expected_net_profit_usd_micros: output.expected_net_profit_usd_micros,
        rejection_flags: output.rejection_flags,
        rejection_reasons: REJECTION_REASONS
            .iter()
            .filter(|(flag, _)| output.rejection_flags & flag != 0)
            .map(|(_, reason)| (*reason).to_string())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{OpportunityFeatures, SimulationProof};
    use chrono::Utc;

    fn opportunity() -> Opportunity {
        Opportunity {
            observation_id: "ffi-test".to_string(),
            observed_at: Utc::now(),
            strategy: "atomic_v2_arbitrage".to_string(),
            features: OpportunityFeatures {
                gross_profit_usd_micros: 1_700_000,
                gas_usd_micros: 120_000,
                relay_usd_micros: 30_000,
                slippage_usd_micros: 90_000,
                notional_usd_micros: 20_000_000,
                available_liquidity_usd_micros: 5_000_000_000,
                calibrated_probability_ppm: 930_000,
                data_age_ms: 120,
                estimated_latency_ms: 180,
            },
            simulation: SimulationProof {
                success: true,
                state_block: 1,
                state_block_hash: format!("0x{:064x}", 1),
                call_result_hash: format!("0x{:064x}", 2),
                protected_route: true,
            },
        }
    }

    #[test]
    fn cpp_ffi_returns_checked_net_profit_and_rejection_mask() {
        let mut candidate = opportunity();
        let decision = evaluate_opportunity(&candidate, &RiskLimits::default());
        assert!(decision.eligible);
        assert_eq!(decision.expected_net_profit_usd_micros, 1_460_000);
        candidate.simulation.protected_route = false;
        let rejected = evaluate_opportunity(&candidate, &RiskLimits::default());
        assert!(!rejected.eligible);
        assert!(rejected.rejection_reasons.contains(&"PUBLIC_ROUTE".to_string()));
    }

    #[test]
    fn cpp_kernel_hot_loop_has_no_transport_scale_latency() {
        let candidate = opportunity();
        let started = std::time::Instant::now();
        let mut eligible = 0_u64;
        for _ in 0..100_000 {
            eligible += u64::from(evaluate_opportunity(&candidate, &RiskLimits::default()).eligible);
        }
        assert_eq!(eligible, 100_000);
        assert!(started.elapsed() < std::time::Duration::from_secs(2));
    }
}
