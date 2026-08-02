use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use dividendpro_mev::{
    evaluate_demotion, evaluate_opportunity, evaluate_promotion,
    model::{
        DemotionEvaluation, DemotionRequest, ExecutionEvidence, ExecutionMode,
        LiveSubmissionRequest, Opportunity, PromotionRequest, RiskLimits, ServiceStatus,
        TerminalExecutionState, BSC_CHAIN_ID,
    },
    reconcile::{hash_opportunity, raw_transaction_hash, reconcile_finalized_execution},
    relay::{load_relays, PrivateRelay},
    replay::run_replay,
    rpc::{parse_hex_u64, BscRpcClient},
    scanner::run_scanner,
    KernelDecision, PromotionEvaluation, ReplayRequest, ReplayResult,
};
use std::{env, sync::Arc, time::Instant};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod bootstrap;

#[derive(Clone)]
struct AppState {
    service_token: Arc<str>,
    region: Arc<str>,
    live_enabled: bool,
    rpc: Option<BscRpcClient>,
    relays: Arc<Vec<PrivateRelay>>,
}

#[derive(Debug)]
struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

fn authorize(headers: &HeaderMap, state: &AppState) -> Result<(), ApiError> {
    let supplied = headers
        .get("x-mev-service-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if supplied.is_empty() || supplied != state.service_token.as_ref() {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "valid server-to-server token required".to_string(),
        ));
    }
    Ok(())
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "ok": true,
        "service": "dividendpro-mev",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<ServiceStatus>, ApiError> {
    authorize(&headers, &state)?;
    Ok(Json(ServiceStatus {
        service: "dividendpro-mev".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        chain_id: BSC_CHAIN_ID,
        region: state.region.to_string(),
        live_execution_enabled: state.live_enabled,
        configured_private_relays: state.relays.len(),
        rpc_configured: state.rpc.is_some(),
        mode_source: "server-authoritative promotion evidence".to_string(),
    }))
}

async fn evaluate(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut opportunity): Json<Opportunity>,
) -> Result<Json<KernelDecision>, ApiError> {
    authorize(&headers, &state)?;
    opportunity.features.data_age_ms = observation_age_ms(&opportunity)?;
    Ok(Json(evaluate_opportunity(&opportunity, &RiskLimits::default())))
}

async fn replay(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ReplayRequest>,
) -> Result<Json<ReplayResult>, ApiError> {
    authorize(&headers, &state)?;
    run_replay(&request)
        .map(Json)
        .map_err(|error| ApiError(StatusCode::UNPROCESSABLE_ENTITY, error.to_string()))
}

async fn promotion(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<PromotionRequest>,
) -> Result<Json<PromotionEvaluation>, ApiError> {
    authorize(&headers, &state)?;
    Ok(Json(evaluate_promotion(&request)))
}

/// Counterpart to `/v1/promotion/evaluate`.
///
/// Promotion gating alone can only move a strategy up. Without a reachable
/// demotion path, evidence that degrades after a strategy reaches CANARY_LIVE
/// or LIVE leaves it trading on the strength of evidence it no longer has.
async fn demotion(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<DemotionRequest>,
) -> Result<Json<DemotionEvaluation>, ApiError> {
    authorize(&headers, &state)?;
    Ok(Json(evaluate_demotion(&request)))
}

fn observation_age_ms(opportunity: &Opportunity) -> Result<u32, ApiError> {
    let age = Utc::now()
        .signed_duration_since(opportunity.observed_at)
        .num_milliseconds();
    if age < 0 {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            "observedAt cannot be in the future".to_string(),
        ));
    }
    Ok(age.min(u32::MAX as i64) as u32)
}

fn terminal_without_submission(
    request: &LiveSubmissionRequest,
    opportunity_hash: String,
    acknowledgements: Vec<dividendpro_mev::RelayAcknowledgement>,
    error: String,
) -> ExecutionEvidence {
    ExecutionEvidence {
        schema_version: 1,
        execution_id: request.execution_id.clone(),
        environment: "LIVE".to_string(),
        terminal_state: TerminalExecutionState::ExpiredNotIncluded,
        tx_hash: None,
        opportunity_hash,
        calldata_hash: request.expected.calldata_hash.clone(),
        included_block_number: None,
        included_block_hash: None,
        finalized_block_number: None,
        finalized_block_hash: None,
        before_balance_base_units: None,
        after_balance_base_units: None,
        realized_profit_base_units: None,
        observed_inclusion_ms: None,
        observed_finality_ms: None,
        relay_acknowledgements: acknowledgements,
        error: Some(error),
        recorded_at: Utc::now(),
    }
}

async fn submit_live(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut request): Json<LiveSubmissionRequest>,
) -> Result<Json<ExecutionEvidence>, ApiError> {
    authorize(&headers, &state)?;
    if !state.live_enabled {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "live execution is disabled by deployment policy".to_string(),
        ));
    }
    if !matches!(request.mode, ExecutionMode::CanaryLive | ExecutionMode::Live) {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "submission requires CANARY_LIVE or LIVE mode".to_string(),
        ));
    }
    if request.raw_transactions.is_empty()
        || request.execution_transaction_index >= request.raw_transactions.len()
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "executionTransactionIndex must select a non-empty raw transaction".to_string(),
        ));
    }
    if request.expires_at <= Utc::now()
        || request.expires_at > Utc::now() + chrono::Duration::seconds(30)
    {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "expiresAt must be within the next 30 seconds".to_string(),
        ));
    }
    for raw in &request.raw_transactions {
        raw_transaction_hash(raw)
            .map_err(|error| ApiError(StatusCode::BAD_REQUEST, error.to_string()))?;
    }

    request.opportunity.features.data_age_ms = observation_age_ms(&request.opportunity)?;
    let mut limits = RiskLimits::default();
    if request.mode == ExecutionMode::Live {
        limits.max_notional_usd_micros = env::var("MEV_MAX_LIVE_NOTIONAL_USD_MICROS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(25_000_000);
    }
    let decision = evaluate_opportunity(&request.opportunity, &limits);
    if !decision.eligible {
        return Err(ApiError(
            StatusCode::UNPROCESSABLE_ENTITY,
            format!("C++ risk kernel rejected opportunity: {:?}", decision.rejection_reasons),
        ));
    }

    let previous_mode = match request.mode {
        ExecutionMode::CanaryLive => ExecutionMode::Simulation,
        ExecutionMode::Live => ExecutionMode::CanaryLive,
        _ => unreachable!(),
    };
    let promotion = evaluate_promotion(&PromotionRequest {
        current_mode: previous_mode,
        evidence: request.evidence_window.clone(),
        policy: None,
    });
    if promotion.target_mode != request.mode {
        return Err(ApiError(
            StatusCode::CONFLICT,
            "promotion evidence does not authorize the requested mode".to_string(),
        ));
    }

    let rpc = state.rpc.as_ref().ok_or_else(|| {
        ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "canonical BSC RPC is not configured".to_string(),
        )
    })?;
    if rpc
        .chain_id()
        .await
        .map_err(internal_error)?
        != BSC_CHAIN_ID
    {
        return Err(ApiError(
            StatusCode::BAD_GATEWAY,
            "configured RPC is not BSC mainnet chain 56".to_string(),
        ));
    }
    let latest = rpc.latest_block().await.map_err(internal_error)?;
    let latest_number = parse_hex_u64(&latest.number).map_err(internal_error)?;
    if request.target_block > latest_number + 20 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "targetBlock cannot be more than 20 BSC blocks ahead".to_string(),
        ));
    }
    // The signed transaction is identical in every geography. A region that
    // receives the request after the originally selected 0.45-second block may
    // safely retarget the private bundle without re-signing or changing nonce.
    request.target_block = request.target_block.max(latest_number + 1);

    let opportunity_hash = hash_opportunity(&request.opportunity).map_err(internal_error)?;
    if state.relays.is_empty() {
        return Ok(Json(terminal_without_submission(
            &request,
            opportunity_hash,
            vec![],
            "no authenticated private relay is configured".to_string(),
        )));
    }

    let submitted_at = Instant::now();
    let mut tasks = tokio::task::JoinSet::new();
    for relay in state.relays.iter().cloned() {
        let transactions = request.raw_transactions.clone();
        let execution_id = request.execution_id.clone();
        let target_block = request.target_block;
        tasks.spawn(async move {
            relay
                .submit_bundle(&transactions, target_block, &execution_id)
                .await
        });
    }
    let mut acknowledgements = Vec::with_capacity(state.relays.len());
    while let Some(result) = tasks.join_next().await {
        if let Ok(acknowledgement) = result {
            acknowledgements.push(acknowledgement);
        }
    }
    if !acknowledgements.iter().any(|ack| ack.accepted) {
        return Ok(Json(terminal_without_submission(
            &request,
            opportunity_hash,
            acknowledgements,
            "every configured private relay rejected or failed the bundle".to_string(),
        )));
    }

    let tx_hash = raw_transaction_hash(
        &request.raw_transactions[request.execution_transaction_index],
    )
    .map_err(|error| ApiError(StatusCode::BAD_REQUEST, error.to_string()))?;
    Ok(Json(
        reconcile_finalized_execution(
            rpc,
            request.execution_id,
            tx_hash,
            opportunity_hash,
            request.expected,
            acknowledgements,
            submitted_at,
            request.expires_at,
        )
        .await,
    ))
}

fn internal_error(error: impl std::fmt::Display) -> ApiError {
    ApiError(StatusCode::BAD_GATEWAY, error.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    bootstrap::load_secret_environment_if_configured().await?;

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "dividendpro_mev=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let service_token = env::var("MEV_SERVICE_TOKEN")
        .map_err(|_| anyhow::anyhow!("MEV_SERVICE_TOKEN is required"))?;
    if service_token.len() < 32 {
        anyhow::bail!("MEV_SERVICE_TOKEN must contain at least 32 characters");
    }
    let rpc = env::var("BSC_RPC_URL")
        .ok()
        .map(BscRpcClient::new)
        .transpose()?;
    let relays = load_relays()?;
    let state = AppState {
        service_token: Arc::from(service_token),
        region: Arc::from(env::var("MEV_REGION").unwrap_or_else(|_| "local".to_string())),
        live_enabled: env::var("MEV_LIVE_EXECUTION_ENABLED").as_deref() == Ok("true"),
        rpc,
        relays: Arc::new(relays),
    };
    // The scanner runs whenever a route is configured, NOT only when live
    // execution is enabled.
    //
    // Gating the scanner on `live_enabled` made the promotion evidence
    // unobtainable: a strategy must accumulate several hundred settled
    // observations before it can be promoted out of SIMULATION, but those
    // observations are produced by the scanner, which would not start until
    // live execution was already on. Evidence that can only be gathered after
    // the decision it is meant to inform is not evidence.
    //
    // Nothing is loosened by this. Whether an observation becomes an execution
    // is decided entirely by the control plane's `executeAuthorized`, which
    // separately requires three regional workers reporting
    // liveExecutionEnabled, MEV_LIVE_EXECUTION_ENABLED on the control plane, a
    // deployed executor address, and all three allowlists. A scanner running
    // without those observes and settles; it cannot execute.
    if env::var("MEV_SCANNER_CONFIG_JSON").is_ok() {
        let scanner_rpc = state.rpc.clone().ok_or_else(|| anyhow::anyhow!(
            "BSC_RPC_URL is required when the scanner is configured"
        ))?;
        tokio::spawn(async move {
            if let Err(error) = run_scanner(scanner_rpc).await {
                tracing::error!(%error, "native MEV scanner stopped");
            }
        });
    }
    let port: u16 = env::var("PORT")
        .unwrap_or_else(|_| "8081".to_string())
        .parse()?;

    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/status", get(status))
        .route("/v1/evaluate", post(evaluate))
        .route("/v1/replay", post(replay))
        .route("/v1/promotion/evaluate", post(promotion))
        .route("/v1/demotion/evaluate", post(demotion))
        .route("/v1/executions", post(submit_live))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!(port, "native MEV orchestrator listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await?;
    Ok(())
}
