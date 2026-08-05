import React, { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import {
  Activity,
  CheckCircle2,
  Clock3,
  Cpu,
  Database,
  Globe2,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  checkRustMevRelayStatus,
  evaluateMevPromotion,
  getMevStrategyStatus,
  type GateResult,
  type MevStrategyStatus,
  type RustMevRelayStatus,
} from "../services/rustMevEngine";

interface QuantAlphaHubProps {
  authUser: User | null;
}

const STRATEGY_ID = "atomic-v2-arbitrage";

const modeColor: Record<string, string> = {
  SIMULATION: "#a78bfa",
  CANARY_LIVE: "#f59e0b",
  LIVE: "#10b981",
  PAUSED: "#ef4444",
};

function metric(value: number | undefined, divisor = 1, suffix = "") {
  if (value === undefined) return "—";
  return `${(value / divisor).toLocaleString(undefined, { maximumFractionDigits: 3 })}${suffix}`;
}

export default function QuantAlphaHub({ authUser }: QuantAlphaHubProps) {
  const [relay, setRelay] = useState<RustMevRelayStatus | null>(null);
  const [strategy, setStrategy] = useState<MevStrategyStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    if (!authUser) {
      setRelay(null);
      setStrategy(null);
      return;
    }
    setLoading(true);
    try {
      const [nextRelay, nextStrategy] = await Promise.all([
        checkRustMevRelayStatus(),
        getMevStrategyStatus(STRATEGY_ID),
      ]);
      setRelay(nextRelay);
      setStrategy(nextStrategy);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "MEV truth status could not be refreshed.");
    } finally {
      setLoading(false);
    }
  }, [authUser]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const evaluatePromotion = async () => {
    setLoading(true);
    setNotice("Evaluating server-owned replay evidence…");
    try {
      const evaluation = await evaluateMevPromotion(STRATEGY_ID);
      setNotice(evaluation.promoted
        ? `Promotion persisted: ${evaluation.previousMode} → ${evaluation.targetMode}.`
        : `No promotion: authoritative mode remains ${evaluation.targetMode}.`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Promotion evaluation failed.");
    } finally {
      setLoading(false);
    }
  };

  const mode = strategy?.mode || "SIMULATION";
  const gates: Record<string, GateResult> = strategy?.lastPromotionEvaluation?.gates || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{
        padding: "22px", borderRadius: "18px",
        background: "linear-gradient(135deg, rgba(124,58,237,.18), rgba(16,185,129,.10))",
        border: "1px solid rgba(167,139,250,.35)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", gap: "9px", alignItems: "center" }}>
              <Cpu color="#a78bfa" size={22} />
              <h2 style={{ margin: 0, color: "#f8fafc", fontSize: "20px" }}>MEV Research Dashboard</h2>
            </div>
            <p style={{ color: "#94a3b8", fontSize: "13px", lineHeight: 1.6, maxWidth: "760px", marginBottom: 0 }}>
              <strong style={{ color: "#f59e0b" }}>Research only.</strong> No live execution is active. Historical and current BSC observations remain simulation evidence until every calibrated 85% gate passes.
              Promotion is server-authoritative: SIMULATION → CANARY_LIVE (capped USD 25) → LIVE only after 20 finalized canary executions with zero evidence failures.
            </p>
          </div>
          <button
            onClick={() => void refresh()}
            disabled={!authUser || loading}
            style={{ alignSelf: "flex-start", border: "1px solid rgba(255,255,255,.14)", borderRadius: "10px", padding: "9px 12px", background: "#111827", color: "#cbd5e1", cursor: authUser ? "pointer" : "not-allowed" }}
          >
            <RefreshCw size={15} style={{ verticalAlign: "middle", marginRight: "7px" }} />Refresh truth
          </button>
        </div>
      </div>

      {!authUser && (
        <div style={{ padding: "16px", borderRadius: "14px", background: "rgba(245,158,11,.10)", border: "1px solid rgba(245,158,11,.35)", color: "#fcd34d", fontSize: "13px" }}>
          <LockKeyhole size={17} style={{ verticalAlign: "middle", marginRight: "8px" }} />
          Sign in to read your server-owned strategy evidence. No worker secret or execution control is exposed to the browser.
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: "12px" }}>
        <TruthCard
          icon={<Activity size={18} />}
          label="Authoritative mode"
          value={mode}
          valueColor={modeColor[mode] || "#94a3b8"}
          detail={strategy ? "Read from per-user Firestore promotion evidence." : "No server replay has been stored yet."}
        />
        <TruthCard
          icon={<Globe2 size={18} />}
          label="Native geography"
          value={relay?.connected ? `${relay.workers.filter(worker => worker.connected).length} WORKER(S)` : "OFFLINE"}
          valueColor={relay?.connected ? "#10b981" : "#f59e0b"}
          detail={relay?.connected ? relay.region : relay?.error || "Workers are not deployed or authenticated."}
        />
        <TruthCard
          icon={<Database size={18} />}
          label="Evidence source"
          value={strategy?.evidenceSource || "NOT AVAILABLE"}
          valueColor={strategy?.evidenceSource === "SERVER_REPLAY" ? "#10b981" : "#94a3b8"}
          detail="Browser-supplied scores cannot promote a strategy."
        />
        <TruthCard
          icon={<Clock3 size={18} />}
          label="Measured control latency"
          value={relay?.connected ? `${relay.latencyMs} ms` : "UNMEASURED"}
          valueColor={relay?.connected ? "#38bdf8" : "#94a3b8"}
          detail="Finality and relay latency are observed per execution, never promised."
        />
      </div>

      {relay?.workers.length ? (
        <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,.08)", borderRadius: "16px", overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", color: "#f8fafc", fontWeight: 800, borderBottom: "1px solid rgba(255,255,255,.08)" }}>Regional native workers</div>
          {relay.workers.map((worker, index) => (
            <div key={`${worker.region}-${index}`} style={{ padding: "13px 16px", display: "grid", gridTemplateColumns: "1.2fr .8fr .8fr 2fr", gap: "10px", borderBottom: index + 1 < relay.workers.length ? "1px solid rgba(255,255,255,.06)" : "none", fontSize: "12px", color: "#94a3b8" }}>
              <span style={{ color: "#e2e8f0", fontWeight: 800 }}>{worker.region}</span>
              <span>{worker.connected ? "CONNECTED" : "OFFLINE"}</span>
              <span>{worker.configuredPrivateRelays || 0} relay(s)</span>
              <span>{worker.error || `chain ${worker.chainId}; RPC ${worker.rpcConfigured ? "configured" : "missing"}`}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: "10px" }}>
        <Metric label="Samples" value={metric(strategy?.evidence?.sampleCount)} />
        <Metric label="Profitable outcomes" value={metric(strategy?.evidence?.profitableCount)} />
        <Metric label="Current calibrated P+" value={metric(strategy?.evidence?.calibratedProbabilityPpm, 10_000, "%")} />
        <Metric label="Wilson lower bound" value={metric(strategy?.lastPromotionEvaluation?.wilsonLowerPpm, 10_000, "%")} />
        <Metric label="Brier loss" value={metric(strategy?.evidence?.brierLossPpm, 1_000_000)} />
        <Metric label="Calibration error" value={metric(strategy?.evidence?.expectedCalibrationErrorPpm, 10_000, "%")} />
        <Metric label="Max drawdown" value={metric(strategy?.evidence?.maxDrawdownBps, 100, "%")} />
        <Metric label="Finalized canaries" value={`${strategy?.evidence?.finalizedCanaryExecutions || 0}/20`} />
      </div>

      <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,.08)", borderRadius: "16px", padding: "17px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div style={{ color: "#f8fafc", fontWeight: 850 }}>Promotion gates</div>
            <div style={{ color: "#64748b", fontSize: "12px", marginTop: "3px" }}>All gates must pass simultaneously; no local override exists.</div>
          </div>
          <button
            onClick={evaluatePromotion}
            disabled={!authUser || !strategy || loading}
            style={{ border: "none", borderRadius: "10px", padding: "10px 14px", background: "#7c3aed", color: "white", fontWeight: 800, cursor: authUser && strategy ? "pointer" : "not-allowed", opacity: authUser && strategy ? 1 : .5 }}
          >Evaluate persisted evidence</button>
        </div>
        <div style={{ marginTop: "14px", display: "grid", gap: "7px" }}>
          {Object.keys(gates).length ? Object.entries(gates).map(([name, gate]) => (
            <div key={name} style={{ display: "grid", gridTemplateColumns: "24px 1.4fr 1fr 1fr", gap: "8px", alignItems: "center", color: "#94a3b8", fontSize: "12px" }}>
              {gate.passed ? <CheckCircle2 size={16} color="#10b981" /> : <XCircle size={16} color="#ef4444" />}
              <span style={{ color: "#e2e8f0" }}>{name}</span>
              <span>actual {gate.actual}</span>
              <span>required {gate.required}</span>
            </div>
          )) : (
            <div style={{ color: "#64748b", fontSize: "12px" }}>No authoritative evaluation exists yet.</div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: "12px" }}>
        <TruthCard icon={<LockKeyhole size={18} />} label="Signing" value="SERVER ONLY" valueColor="#10b981" detail="Private key is loaded from the deployment secret; the browser never receives it." />
        <TruthCard icon={<ShieldAlert size={18} />} label="Execution invariant" value="ATOMIC OR REVERT" valueColor="#10b981" detail="The allowlisted contract reverts unless post-trade token balance meets minimum profit." />
        <TruthCard icon={<CheckCircle2 size={18} />} label="Realized result" value="FINALIZED EVIDENCE ONLY" valueColor="#10b981" detail="Receipt, calldata, event, token amount, and BSC finalized block must reconcile." />
      </div>

      {notice && (
        <div style={{ padding: "12px 14px", borderRadius: "11px", border: "1px solid rgba(56,189,248,.3)", background: "rgba(56,189,248,.08)", color: "#bae6fd", fontSize: "12px" }}>{notice}</div>
      )}
    </div>
  );
}

function TruthCard({ icon, label, value, valueColor, detail }: { icon: React.ReactNode; label: string; value: string; valueColor: string; detail: string }) {
  return (
    <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,.08)", borderRadius: "14px", padding: "15px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "7px", color: "#a78bfa", fontSize: "12px", fontWeight: 800 }}>{icon}{label}</div>
      <div style={{ color: valueColor, fontSize: "14px", fontWeight: 900, marginTop: "8px" }}>{value}</div>
      <div style={{ color: "#64748b", fontSize: "11px", lineHeight: 1.45, marginTop: "4px" }}>{detail}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#111827", border: "1px solid rgba(255,255,255,.07)", borderRadius: "12px", padding: "13px" }}>
      <div style={{ color: "#64748b", fontSize: "10px", textTransform: "uppercase", fontWeight: 800 }}>{label}</div>
      <div style={{ color: "#f8fafc", fontSize: "17px", fontWeight: 900, marginTop: "5px" }}>{value}</div>
    </div>
  );
}
