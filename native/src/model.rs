use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const BSC_CHAIN_ID: u64 = 56;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpportunityFeatures {
    pub gross_profit_usd_micros: i64,
    pub gas_usd_micros: i64,
    pub relay_usd_micros: i64,
    pub slippage_usd_micros: i64,
    pub notional_usd_micros: i64,
    pub available_liquidity_usd_micros: i64,
    pub calibrated_probability_ppm: u32,
    pub data_age_ms: u32,
    pub estimated_latency_ms: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationProof {
    pub success: bool,
    pub state_block: u64,
    pub state_block_hash: String,
    pub call_result_hash: String,
    #[serde(default = "default_true")]
    pub protected_route: bool,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opportunity {
    pub observation_id: String,
    pub observed_at: DateTime<Utc>,
    pub strategy: String,
    pub features: OpportunityFeatures,
    pub simulation: SimulationProof,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskLimits {
    pub max_notional_usd_micros: i64,
    pub min_liquidity_usd_micros: i64,
    pub min_probability_ppm: u32,
    pub max_data_age_ms: u32,
    pub max_estimated_latency_ms: u32,
    pub require_protected_route: bool,
}

impl Default for RiskLimits {
    fn default() -> Self {
        Self {
            max_notional_usd_micros: 25_000_000,
            min_liquidity_usd_micros: 100_000_000,
            min_probability_ppm: 850_000,
            max_data_age_ms: 900,
            max_estimated_latency_ms: 1_000,
            require_protected_route: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KernelDecision {
    pub eligible: bool,
    pub expected_net_profit_usd_micros: i64,
    pub rejection_flags: u32,
    pub rejection_reasons: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExecutionMode {
    Simulation,
    CanaryLive,
    Live,
    Paused,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceWindow {
    pub model_version: String,
    pub sample_count: u64,
    pub profitable_count: u64,
    pub calibrated_probability_ppm: u32,
    pub brier_loss_ppm: u32,
    pub expected_calibration_error_ppm: u32,
    pub profit_factor_ppm: u32,
    pub max_drawdown_bps: u32,
    pub data_integrity_passed: bool,
    #[serde(default)]
    pub execution_readiness_passed: bool,
    // These two counters are owned by the execution/settlement path, not by
    // replay. The worker has no way to observe them and `run_replay` always
    // builds them as 0, so serializing them lets a replay response overwrite
    // real execution history in the control plane's strategy document. They are
    // accepted on the way in (for promotion evaluation) and never emitted.
    #[serde(default, skip_serializing)]
    pub finalized_canary_executions: u32,
    #[serde(default, skip_serializing)]
    pub canary_evidence_failures: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionPolicy {
    pub min_probability_ppm: u32,
    pub min_wilson_lower_ppm: u32,
    pub min_sample_count: u64,
    pub max_brier_loss_ppm: u32,
    pub max_expected_calibration_error_ppm: u32,
    pub min_profit_factor_ppm: u32,
    pub max_drawdown_bps: u32,
    pub min_finalized_canary_executions: u32,
}

impl Default for PromotionPolicy {
    fn default() -> Self {
        Self {
            min_probability_ppm: 850_000,
            min_wilson_lower_ppm: 850_000,
            min_sample_count: 200,
            max_brier_loss_ppm: 100_000,
            max_expected_calibration_error_ppm: 50_000,
            min_profit_factor_ppm: 1_250_000,
            max_drawdown_bps: 500,
            min_finalized_canary_executions: 20,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateResult {
    pub passed: bool,
    pub actual: String,
    pub required: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionEvaluation {
    pub previous_mode: ExecutionMode,
    pub target_mode: ExecutionMode,
    pub promoted: bool,
    pub wilson_lower_ppm: u32,
    pub evaluated_at: DateTime<Utc>,
    pub gates: BTreeMap<String, GateResult>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionRequest {
    pub current_mode: ExecutionMode,
    pub evidence: EvidenceWindow,
    #[serde(default)]
    pub policy: Option<PromotionPolicy>,
}

/// Floors below which a *live* strategy is pulled back to `Paused`.
///
/// These are deliberately looser than [`PromotionPolicy`]. The gap between the
/// two is a hysteresis dead band: without it, a strategy sitting exactly on the
/// promotion threshold would oscillate between `Live` and `Paused` on ordinary
/// sampling noise, and every oscillation spends real gas.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemotionPolicy {
    pub min_wilson_lower_ppm: u32,
    pub min_probability_ppm: u32,
    pub max_brier_loss_ppm: u32,
    pub max_expected_calibration_error_ppm: u32,
    pub min_profit_factor_ppm: u32,
    pub max_drawdown_bps: u32,
}

impl Default for DemotionPolicy {
    fn default() -> Self {
        // Each floor sits below its promotion counterpart by a margin wide
        // enough to absorb noise at the 200-sample minimum window.
        Self {
            min_wilson_lower_ppm: 800_000,              // promote at 850_000
            min_probability_ppm: 800_000,               // promote at 850_000
            max_brier_loss_ppm: 150_000,                // promote under 100_000
            max_expected_calibration_error_ppm: 80_000, // promote under 50_000
            min_profit_factor_ppm: 1_050_000,           // promote at 1_250_000
            max_drawdown_bps: 800,                      // promote under 500
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemotionRequest {
    pub current_mode: ExecutionMode,
    pub evidence: EvidenceWindow,
    #[serde(default)]
    pub policy: Option<DemotionPolicy>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemotionEvaluation {
    pub previous_mode: ExecutionMode,
    pub target_mode: ExecutionMode,
    pub demoted: bool,
    pub wilson_lower_ppm: u32,
    pub evaluated_at: DateTime<Utc>,
    /// Only the gates that actually failed. Empty means nothing breached.
    pub breaches: BTreeMap<String, GateResult>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayRecord {
    pub opportunity: Opportunity,
    pub realized_net_profit_usd_micros: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayRequest {
    pub model_version: String,
    pub starting_capital_usd_micros: i64,
    pub records: Vec<ReplayRecord>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayResult {
    pub evidence: EvidenceWindow,
    pub accepted_records: u64,
    pub rejected_records: u64,
    pub duplicate_observation_ids: u64,
    pub time_order_violations: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpectedExecution {
    pub sender: String,
    pub executor: String,
    pub calldata_hash: String,
    pub execution_id_hash: String,
    pub profit_token: String,
    pub profit_recipient: String,
    pub minimum_profit_base_units: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSubmissionRequest {
    pub execution_id: String,
    pub mode: ExecutionMode,
    pub opportunity: Opportunity,
    pub evidence_window: EvidenceWindow,
    pub raw_transactions: Vec<String>,
    pub execution_transaction_index: usize,
    pub target_block: u64,
    pub expires_at: DateTime<Utc>,
    pub expected: ExpectedExecution,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayAcknowledgement {
    pub provider: String,
    pub region: String,
    pub accepted: bool,
    pub latency_ms: u64,
    pub reference: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TerminalExecutionState {
    FinalizedProfit,
    FinalizedLoss,
    Reverted,
    ExpiredNotIncluded,
    EvidenceMismatch,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionEvidence {
    pub schema_version: u32,
    pub execution_id: String,
    pub environment: String,
    pub terminal_state: TerminalExecutionState,
    pub tx_hash: Option<String>,
    pub opportunity_hash: String,
    pub calldata_hash: String,
    pub included_block_number: Option<u64>,
    pub included_block_hash: Option<String>,
    pub finalized_block_number: Option<u64>,
    pub finalized_block_hash: Option<String>,
    pub before_balance_base_units: Option<String>,
    pub after_balance_base_units: Option<String>,
    pub realized_profit_base_units: Option<String>,
    pub observed_inclusion_ms: Option<u64>,
    pub observed_finality_ms: Option<u64>,
    pub relay_acknowledgements: Vec<RelayAcknowledgement>,
    pub error: Option<String>,
    pub recorded_at: DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceStatus {
    pub service: String,
    pub version: String,
    pub chain_id: u64,
    pub region: String,
    pub live_execution_enabled: bool,
    pub configured_private_relays: usize,
    pub rpc_configured: bool,
    pub mode_source: String,
}
