import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { authenticateFirebaseRequest } from "./truthLayer";

type WorkerConfig = { region: string; url: string };

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "dividendpro-3b397";
const STRATEGY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function getAdminApp() {
  return getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}

function getWorkers(): WorkerConfig[] {
  const raw = process.env.MEV_ORCHESTRATOR_URLS_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is WorkerConfig =>
        item && typeof item.region === "string" && typeof item.url === "string" && /^https?:\/\//.test(item.url),
      );
    } catch {
      return [];
    }
  }
  const url = process.env.MEV_ORCHESTRATOR_URL;
  return url ? [{ region: process.env.MEV_REGION || "local", url }] : [];
}

function serviceToken(): string | null {
  const token = process.env.MEV_SERVICE_TOKEN;
  return token && token.length >= 32 ? token : null;
}

function internalTokenMatches(req: Request): boolean {
  const expected = process.env.MEV_EXECUTOR_INTERNAL_TOKEN || "";
  const supplied = req.header("x-mev-internal-token") || "";
  if (expected.length < 32 || expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

async function callWorker<T>(worker: WorkerConfig, path: string, init?: RequestInit): Promise<T> {
  const token = serviceToken();
  if (!token) throw new Error("MEV_SERVICE_TOKEN is not configured.");
  const response = await fetch(`${worker.url.replace(/\/$/, "")}${path}`, {
    ...init,
    signal: AbortSignal.timeout(path === "/v1/executions" ? 50_000 : 8_000),
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "x-mev-service-token": token,
      ...(init?.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : `Native worker returned HTTP ${response.status}.`);
  }
  return body as T;
}

async function firstHealthyWorker<T>(path: string, init?: RequestInit): Promise<T> {
  const workers = getWorkers();
  if (workers.length === 0) throw new Error("No native MEV worker is configured.");
  const failures: string[] = [];
  for (const worker of workers) {
    try {
      return await callWorker<T>(worker, path, init);
    } catch (error) {
      failures.push(`${worker.region}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Every native worker failed: ${failures.join(" | ")}`);
}

async function rpcValue(method: string, params: unknown[]): Promise<unknown> {
  const rpcUrl = process.env.BSC_RPC_URL;
  if (!rpcUrl) return null;
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body?.error ? null : body?.result;
}

async function deploymentReadinessPassed(): Promise<boolean> {
  const workers = getWorkers();
  const requiredRegions = new Set(["asia-northeast1", "europe-west3", "us-east4"]);
  if (workers.length < 3 || ![...requiredRegions].every(region => workers.some(worker => worker.region === region))) {
    return false;
  }
  const statuses = await Promise.all(workers.map(statusForWorker));
  const workersReady = statuses.every(status => status.connected
    && status.liveExecutionEnabled === true
    && status.rpcConfigured === true
    && Number(status.configuredPrivateRelays || 0) > 0);
  if (!workersReady || process.env.MEV_LIVE_EXECUTION_ENABLED !== "true") return false;

  const executor = process.env.MEV_EXECUTOR_ADDRESS || "";
  const signer = process.env.MEV_EXECUTION_PRIVATE_KEY || "";
  const serverConfigReady = /^0x[0-9a-fA-F]{40}$/.test(executor)
    && /^0x[0-9a-fA-F]{64}$/.test(signer)
    && Boolean(process.env.MEV_ROUTER_ALLOWLIST)
    && Boolean(process.env.MEV_TOKEN_ALLOWLIST)
    && Boolean(process.env.MEV_PROFIT_RECIPIENT_ALLOWLIST)
    && Boolean(process.env.MEV_EXECUTOR_INTERNAL_TOKEN);
  if (!serverConfigReady) return false;
  const [chainId, bytecode] = await Promise.all([
    rpcValue("eth_chainId", []),
    rpcValue("eth_getCode", [executor, "latest"]),
  ]);
  return chainId === "0x38" && typeof bytecode === "string" && bytecode !== "0x";
}

async function statusForWorker(worker: WorkerConfig): Promise<Record<string, any>> {
  const started = Date.now();
  try {
    const status = await callWorker<Record<string, unknown>>(worker, "/v1/status");
    return { ...status, connected: true, controlPlaneLatencyMs: Date.now() - started };
  } catch (error) {
    return {
      connected: false,
      region: worker.region,
      controlPlaneLatencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function strategyPath(uid: string, strategyId: string): string {
  return `users/${uid}/mevStrategies/${strategyId}`;
}

export async function evaluateStoredPromotion(uid: string, strategyId: string) {
  const ref = getFirestore(getAdminApp()).doc(strategyPath(uid, strategyId));
  const snapshot = await ref.get();
  const stored = snapshot.data();
  if (!stored || stored.evidenceSource !== "SERVER_REPLAY" || !stored.evidence) {
    throw new Error("Server-derived replay evidence is not available.");
  }
  const currentMode = typeof stored.mode === "string" ? stored.mode : "SIMULATION";
  const evidence = structuredClone(stored.evidence);
  evidence.executionReadinessPassed = await deploymentReadinessPassed();
  const evaluation = await firstHealthyWorker<Record<string, unknown>>("/v1/promotion/evaluate", {
    method: "POST",
    body: JSON.stringify({ currentMode, evidence }),
  });
  const targetMode = typeof evaluation.targetMode === "string" ? evaluation.targetMode : currentMode;
  await ref.set({
    mode: targetMode,
    evidence,
    lastPromotionEvaluation: evaluation,
    promotionUpdatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { strategyId, evaluation, persisted: true };
}

function parseStrategyId(value: unknown): string {
  const strategyId = String(value || "");
  if (!STRATEGY_ID_PATTERN.test(strategyId)) throw new Error("Invalid strategyId.");
  return strategyId;
}

function authFailure(res: Response): void {
  res.status(401).json({ error: "Authenticated Firebase session required." });
}

export function registerMevControlRoutes(app: Express): void {
  app.get("/api/mev/status", async (req, res) => {
    try {
      await authenticateFirebaseRequest(req);
      const workers = getWorkers();
      if (workers.length === 0 || !serviceToken()) {
        return void res.json({
          connected: false,
          environment: "OFFLINE",
          workers: [],
          error: "Native workers and server-to-server credentials are not configured.",
        });
      }
      const statuses = await Promise.all(workers.map(statusForWorker));
      res.json({
        connected: statuses.some(status => status.connected),
        environment: "SERVER_MANAGED",
        workers: statuses,
      });
    } catch {
      authFailure(res);
    }
  });

  app.post("/api/mev/evaluate", async (req, res) => {
    try {
      await authenticateFirebaseRequest(req);
      const decision = await firstHealthyWorker("/v1/evaluate", {
        method: "POST",
        body: JSON.stringify(req.body),
      });
      res.json({ environment: "SIMULATION", decision });
    } catch (error) {
      if (String(error).includes("Firebase")) return void authFailure(res);
      res.status(503).json({ error: error instanceof Error ? error.message : "MEV evaluation failed." });
    }
  });

  // Historical outcomes are ingested only by the server-side data pipeline.
  // Browser-supplied replay metrics can never authorize a mainnet promotion.
  app.post("/api/mev/internal/replay", async (req, res) => {
    if (!internalTokenMatches(req)) return void res.status(401).json({ error: "Internal executor token required." });
    try {
      const uid = String(req.body?.uid || "");
      if (!uid || uid.length > 128) throw new Error("Invalid uid.");
      const strategyId = parseStrategyId(req.body?.strategyId);
      const replay = await firstHealthyWorker<Record<string, unknown>>("/v1/replay", {
        method: "POST",
        body: JSON.stringify(req.body?.replay),
      });
      const evidence = replay.evidence;
      if (!evidence || typeof evidence !== "object") throw new Error("Native replay returned no evidence.");
      await getFirestore(getAdminApp()).doc(strategyPath(uid, strategyId)).set({
        schemaVersion: 1,
        strategyId,
        mode: "SIMULATION",
        replay,
        evidence,
        evidenceSource: "SERVER_REPLAY",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      res.json({ stored: true, replay });
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : "Replay failed." });
    }
  });

  // Always-on scanners post observations here in every mode. The server owns
  // the online probability, replay window, and transition decision.
  app.post("/api/mev/internal/observe", async (req, res) => {
    if (!internalTokenMatches(req)) return void res.status(401).json({ error: "Internal executor token required." });
    try {
      const uid = String(req.body?.uid || "");
      if (!uid || uid.length > 128) throw new Error("Invalid uid.");
      const strategyId = parseStrategyId(req.body?.strategyId);
      const opportunity = structuredClone(req.body?.opportunity || {});
      const realizedNetProfitUsdMicros = Number(req.body?.realizedNetProfitUsdMicros);
      if (!Number.isSafeInteger(realizedNetProfitUsdMicros)) {
        throw new Error("realizedNetProfitUsdMicros must be a safe integer.");
      }
      if (!opportunity?.observationId || !opportunity?.features || !opportunity?.observedAt) {
        throw new Error("Observation is incomplete.");
      }
      const observedAt = new Date(opportunity.observedAt);
      if (!Number.isFinite(observedAt.getTime()) || observedAt.getTime() > Date.now() + 1_000) {
        throw new Error("Observation timestamp is invalid.");
      }

      const db = getFirestore(getAdminApp());
      const strategyRef = db.doc(strategyPath(uid, strategyId));
      const existing = (await strategyRef.get()).data();
      const priorSamples = Number(existing?.evidence?.sampleCount || 0);
      const priorProfitable = Number(existing?.evidence?.profitableCount || 0);
      const prequentialProbability = Math.round(
        Math.min(0.99, Math.max(0.01, (priorProfitable + 1) / (priorSamples + 2))) * 1_000_000,
      );
      opportunity.features.calibratedProbabilityPpm = prequentialProbability;
      const stateHash = String(opportunity?.simulation?.callResultHash || "");
      if (!/^0x[0-9a-fA-F]{64}$/.test(stateHash)) throw new Error("Simulation state hash is invalid.");
      // State commitment, not a caller-selected ID, is the global dedupe key.
      const observationDocId = crypto
        .createHash("sha256")
        .update(stateHash.toLowerCase())
        .digest("hex");
      const observationRef = strategyRef.collection("simulationObservations").doc(observationDocId);
      await db.runTransaction(async transaction => {
        const latestStrategy = (await transaction.get(strategyRef)).data();
        if (latestStrategy?.lastSimulationStateHash === stateHash) {
          throw new Error("DUPLICATE_SIMULATION_STATE");
        }
        transaction.create(observationRef, {
          schemaVersion: 1,
          opportunity,
          realizedNetProfitUsdMicros,
          outcomeSource: "BLOCK_STATE_ATOMIC_SIMULATION",
          observedAt,
          recordedAt: FieldValue.serverTimestamp(),
        });
        transaction.set(strategyRef, {
          lastSimulationStateHash: stateHash,
          lastObservationAt: observedAt,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      });

      const snapshots = await strategyRef.collection("simulationObservations")
        .orderBy("observedAt", "desc")
        .limit(1_000)
        .get();
      const records = snapshots.docs
        .map(snapshot => snapshot.data())
        .reverse()
        .map(record => ({
          opportunity: record.opportunity,
          realizedNetProfitUsdMicros: record.realizedNetProfitUsdMicros,
        }));
      const replay = await firstHealthyWorker<Record<string, any>>("/v1/replay", {
        method: "POST",
        body: JSON.stringify({
          modelVersion: "online-beta-binomial-v1",
          startingCapitalUsdMicros: Number(req.body?.startingCapitalUsdMicros || 100_000_000),
          records,
        }),
      });
      await strategyRef.set({
        schemaVersion: 1,
        strategyId,
        mode: existing?.mode || "SIMULATION",
        replay,
        evidence: replay.evidence,
        evidenceSource: "SERVER_REPLAY",
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      const promotion = await evaluateStoredPromotion(uid, strategyId);
      const targetMode = String((promotion.evaluation as any)?.targetMode || "SIMULATION");
      res.json({
        stored: true,
        sampleCount: replay.evidence?.sampleCount,
        mode: targetMode,
        executeAuthorized: targetMode === "CANARY_LIVE" || targetMode === "LIVE",
        calibratedProbabilityPpm: prequentialProbability,
        promotion: promotion.evaluation,
      });
    } catch (error: any) {
      if (error?.code === 6
          || String(error?.message || "").includes("ALREADY_EXISTS")
          || String(error?.message || "").includes("DUPLICATE_SIMULATION_STATE")) {
        return void res.status(409).json({ error: "Observation already recorded." });
      }
      res.status(422).json({ error: error instanceof Error ? error.message : "Observation replay failed." });
    }
  });

  app.post("/api/mev/promotion/evaluate", async (req, res) => {
    try {
      const user = await authenticateFirebaseRequest(req);
      const strategyId = parseStrategyId(req.body?.strategyId);
      // The evidence store is itself a live gate. If this read/write cycle
      // fails, no promotion response is returned and execution remains closed.
      res.json(await evaluateStoredPromotion(user.uid, strategyId));
    } catch (error) {
      if (String(error).includes("Firebase")) return void authFailure(res);
      res.status(503).json({ error: error instanceof Error ? error.message : "Promotion evaluation failed." });
    }
  });

  app.get("/api/mev/strategies/:strategyId", async (req, res) => {
    try {
      const user = await authenticateFirebaseRequest(req);
      const strategyId = parseStrategyId(req.params.strategyId);
      const snapshot = await getFirestore(getAdminApp()).doc(strategyPath(user.uid, strategyId)).get();
      if (!snapshot.exists) return void res.status(404).json({ error: "Strategy evidence not found." });
      res.json(snapshot.data());
    } catch (error) {
      if (String(error).includes("Firebase")) return void authFailure(res);
      res.status(400).json({ error: error instanceof Error ? error.message : "Strategy lookup failed." });
    }
  });
}

export async function submitSignedExecutionToWorkers(payload: Record<string, unknown>) {
  const workers = getWorkers();
  if (workers.length === 0) throw new Error("No native MEV workers are configured.");
  const results = await Promise.allSettled(workers.map(worker => callWorker<Record<string, unknown>>(
    worker,
    "/v1/executions",
    { method: "POST", body: JSON.stringify(payload) },
  )));
  const fulfilled = results
    .filter((result): result is PromiseFulfilledResult<Record<string, unknown>> => result.status === "fulfilled")
    .map(result => result.value);
  if (fulfilled.length === 0) {
    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map(result => result.reason instanceof Error ? result.reason.message : String(result.reason));
    throw new Error(`Every geographic worker failed: ${errors.join(" | ")}`);
  }
  const rank: Record<string, number> = {
    FINALIZED_PROFIT: 5,
    FINALIZED_LOSS: 4,
    REVERTED: 3,
    EVIDENCE_MISMATCH: 2,
    EXPIRED_NOT_INCLUDED: 1,
  };
  fulfilled.sort((a, b) => (rank[String(b.terminalState)] || 0) - (rank[String(a.terminalState)] || 0));
  return { canonical: fulfilled[0], regional: fulfilled };
}
