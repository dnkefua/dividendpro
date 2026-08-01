import { authenticatedApiFetch } from "./authenticatedApi";

export type ExecutionMode = "SIMULATION" | "CANARY_LIVE" | "LIVE" | "PAUSED";

export interface NativeWorkerStatus {
  connected: boolean;
  region: string;
  version?: string;
  chainId?: number;
  liveExecutionEnabled?: boolean;
  configuredPrivateRelays?: number;
  rpcConfigured?: boolean;
  controlPlaneLatencyMs: number;
  error?: string;
}

export interface RustMevRelayStatus {
  connected: boolean;
  environment: "SERVER_MANAGED" | "OFFLINE";
  workers: NativeWorkerStatus[];
  region: string;
  relayProvider: string;
  latencyMs: number;
  protectedRouteRequired: true;
  error?: string;
}

export interface GateResult {
  passed: boolean;
  actual: string;
  required: string;
}

export interface PromotionEvaluation {
  previousMode: ExecutionMode;
  targetMode: ExecutionMode;
  promoted: boolean;
  wilsonLowerPpm: number;
  evaluatedAt: string;
  gates: Record<string, GateResult>;
}

export interface MevStrategyStatus {
  strategyId: string;
  mode: ExecutionMode;
  evidenceSource: "SERVER_REPLAY";
  evidence?: {
    modelVersion: string;
    sampleCount: number;
    profitableCount: number;
    calibratedProbabilityPpm: number;
    brierLossPpm: number;
    expectedCalibrationErrorPpm: number;
    profitFactorPpm: number;
    maxDrawdownBps: number;
    executionReadinessPassed: boolean;
    finalizedCanaryExecutions: number;
    canaryEvidenceFailures: number;
  };
  lastPromotionEvaluation?: PromotionEvaluation;
  lastExecutionState?: string;
}

export async function checkRustMevRelayStatus(): Promise<RustMevRelayStatus> {
  try {
    const response = await authenticatedApiFetch("/api/mev/status");
    if (!response.ok) throw new Error(`MEV status returned HTTP ${response.status}.`);
    const status = await response.json();
    const workers: NativeWorkerStatus[] = Array.isArray(status.workers) ? status.workers : [];
    const connectedWorkers = workers.filter(worker => worker.connected);
    return {
      connected: Boolean(status.connected) && connectedWorkers.length > 0,
      environment: status.environment === "SERVER_MANAGED" ? "SERVER_MANAGED" : "OFFLINE",
      workers,
      region: connectedWorkers.map(worker => worker.region).join(", ") || "not deployed",
      relayProvider: connectedWorkers.length
        ? `${connectedWorkers.reduce((sum, worker) => sum + Number(worker.configuredPrivateRelays || 0), 0)} authenticated private relay adapter(s)`
        : "none",
      latencyMs: connectedWorkers.length
        ? Math.min(...connectedWorkers.map(worker => worker.controlPlaneLatencyMs))
        : 0,
      protectedRouteRequired: true,
      error: status.error,
    };
  } catch (error) {
    return {
      connected: false,
      environment: "OFFLINE",
      workers: [],
      region: "not deployed",
      relayProvider: "none",
      latencyMs: 0,
      protectedRouteRequired: true,
      error: error instanceof Error ? error.message : "Native MEV status is unavailable.",
    };
  }
}

export async function getMevStrategyStatus(strategyId: string): Promise<MevStrategyStatus | null> {
  const response = await authenticatedApiFetch(`/api/mev/strategies/${encodeURIComponent(strategyId)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Strategy evidence returned HTTP ${response.status}.`);
  return response.json();
}

export async function evaluateMevPromotion(strategyId: string): Promise<PromotionEvaluation> {
  const response = await authenticatedApiFetch("/api/mev/promotion/evaluate", {
    method: "POST",
    body: JSON.stringify({ strategyId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Promotion evaluation returned HTTP ${response.status}.`);
  return body.evaluation;
}

// Live bundle creation/submission is intentionally absent from the browser API.
// The server-side scanner, signer, and evidence pipeline are the only callers.
