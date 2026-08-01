import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  runBacktest, STRATEGIES, BacktestResult, BacktestConfig,
  LSETimeframe, fetchUsage, createLSEStream, LSETick,
} from "../services/lseService";
import {
  TrendingUp, TrendingDown, BarChart2, Zap, RefreshCw,
  Play, CheckCircle, AlertCircle, Activity, Target,
  Award, Shield, Clock, ArrowRight, Info
} from "lucide-react";

// ── Crypto symbols available on LSE ──────────────────────────────────────────
const CRYPTO_SYMBOLS = [
  "BTC/USD", "ETH/USD", "BNB/USD", "SOL/USD", "XRP/USD",
  "ADA/USD", "DOGE/USD", "AVAX/USD", "MATIC/USD", "LINK/USD",
  "DOT/USD", "LTC/USD", "UNI/USD", "ATOM/USD", "NEAR/USD",
];

const TIMEFRAMES: { value: LSETimeframe; label: string }[] = [
  { value: "1h",  label: "1 Hour" },
  { value: "4h",  label: "4 Hours" },
  { value: "1d",  label: "Daily" },
];

// ── Simple equity curve sparkline ─────────────────────────────────────────────
function MiniChart({ data, color }: { data: number[]; color: string }) {
  if (!data.length) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const W = 200, H = 50;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color = "#e2e8f0", icon }: {
  label: string; value: string; sub?: string; color?: string; icon?: React.ReactNode;
}) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#475569", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "8px" }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: "20px", fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px" }}>{sub}</div>}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StrategyLabView() {
  // Config
  const [symbol, setSymbol] = useState("BTC/USD");
  const [timeframe, setTimeframe] = useState<LSETimeframe>("1h");
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [capital, setCapital] = useState(1000);
  const [tp, setTp] = useState(15);
  const [sl, setSl] = useState(7);
  const [selectedStrategy, setSelectedStrategy] = useState(0);

  // Results
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState("");
  const [activeResult, setActiveResult] = useState<BacktestResult | null>(null);
  const [runAll, setRunAll] = useState(false);

  // Live feed
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [streamStatus, setStreamStatus] = useState<"off" | "on" | "error">("off");
  const streamCleanup = useRef<(() => void) | null>(null);

  // Usage
  const [usage, setUsage] = useState<{ calls_per_minute: number; monthly_bytes_used: number; monthly_bytes_limit: number } | null>(null);

  useEffect(() => {
    fetchUsage().then(setUsage).catch(() => {});
    // Auto-run initial strategy backtest so Strategy Lab is immediately active with live metrics
    runSingle();
  }, []);

  // ── Run single backtest ───────────────────────────────────────────────────

  const runSingle = useCallback(async () => {
    setIsRunning(true);
    setError("");
    try {
      const config: BacktestConfig = {
        symbol,
        timeframe,
        startDate,
        endDate,
        initialCapital: capital,
        takeProfitPct: tp,
        stopLossPct: sl,
        strategy: STRATEGIES[selectedStrategy],
      };
      const result = await runBacktest(config);
      setResults(prev => {
        const filtered = prev.filter(r => r.strategy !== result.strategy || r.symbol !== result.symbol || r.timeframe !== result.timeframe);
        return [result, ...filtered].slice(0, 20);
      });
      setActiveResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backtest failed");
    } finally {
      setIsRunning(false);
    }
  }, [symbol, timeframe, startDate, endDate, capital, tp, sl, selectedStrategy]);

  // ── Run all strategies ────────────────────────────────────────────────────

  const runAllStrategies = useCallback(async () => {
    setIsRunning(true);
    setError("");
    setRunAll(true);
    const newResults: BacktestResult[] = [];
    for (const strategy of STRATEGIES) {
      try {
        const result = await runBacktest({ symbol, timeframe, startDate, endDate, initialCapital: capital, takeProfitPct: tp, stopLossPct: sl, strategy });
        newResults.push(result);
      } catch { /* continue */ }
    }
    // Sort by win rate descending
    newResults.sort((a, b) => b.winRate - a.winRate);
    setResults(newResults);
    if (newResults.length) setActiveResult(newResults[0]);
    setIsRunning(false);
    setRunAll(false);
  }, [symbol, timeframe, startDate, endDate, capital, tp, sl]);

  // ── Save a paper strategy candidate for future review ────────────────────

  const applyToSniper = (result: BacktestResult) => {
    // This record cannot activate the fail-closed sniper.
    const sniperEnhancement = {
      strategyName: result.strategy,
      winRate: result.winRate,
      symbol: result.symbol,
      timeframe: result.timeframe,
      tp: tp,
      sl: sl,
      appliedAt: new Date().toISOString(),
    };
    localStorage.setItem("divpro_sniper_strategy", JSON.stringify(sniperEnhancement));
    alert(`🧪 Paper strategy "${result.strategy}" saved for future review.\nSimulated win rate: ${result.winRate.toFixed(1)}%\nNo live sniper action was enabled.`);
  };

  // ── Live stream ───────────────────────────────────────────────────────────

  const toggleStream = () => {
    if (streamStatus === "on") {
      streamCleanup.current?.();
      streamCleanup.current = null;
      setStreamStatus("off");
      return;
    }
    const cleanup = createLSEStream(
      [symbol],
      (tick: LSETick) => setLivePrices(prev => ({ ...prev, [tick.symbol]: tick.price })),
      () => setStreamStatus("error")
    );
    streamCleanup.current = cleanup;
    setStreamStatus("on");
  };

  useEffect(() => () => streamCleanup.current?.(), []);

  // ── Score color ───────────────────────────────────────────────────────────

  const winColor = (wr: number) => wr >= 60 ? "#10b981" : wr >= 45 ? "#f59e0b" : "#f87171";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "24px 16px", display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "linear-gradient(135deg, #1e40af, #3b82f6)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <BarChart2 size={22} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#e2e8f0", margin: 0 }}>Strategy Lab</h1>
            <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
              Paper backtests using public market data with an explicitly labelled synthetic fallback
            </p>
          </div>
        </div>
        {usage && usage.monthly_bytes_limit > 0 ? (
          <div style={{ fontSize: "11px", color: "#475569", textAlign: "right" }}>
            <div>API: {usage.calls_per_minute} req/min</div>
            <div>{((usage.monthly_bytes_used / usage.monthly_bytes_limit) * 100).toFixed(1)}% monthly usage</div>
          </div>
        ) : <div style={{ fontSize: "11px", color: "#f59e0b" }}>Private dataset adapter unavailable</div>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "16px", alignItems: "start" }}>

        {/* ── LEFT: Config Panel ──────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          {/* Config Card */}
          <div style={{ background: "rgba(15,20,30,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", padding: "18px" }}>
            <h3 style={{ fontSize: "13px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "16px" }}>
              Configuration
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "5px" }}>Symbol</label>
                <select value={symbol} onChange={e => setSymbol(e.target.value)}
                  style={{ width: "100%", padding: "8px 10px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#e2e8f0", fontSize: "13px" }}>
                  {CRYPTO_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "5px" }}>Timeframe</label>
                <div style={{ display: "flex", gap: "6px" }}>
                  {TIMEFRAMES.map(tf => (
                    <button key={tf.value} onClick={() => setTimeframe(tf.value)}
                      style={{ flex: 1, padding: "7px", background: timeframe === tf.value ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.04)", border: `1px solid ${timeframe === tf.value ? "rgba(59,130,246,0.5)" : "rgba(255,255,255,0.08)"}`, borderRadius: "7px", color: timeframe === tf.value ? "#60a5fa" : "#64748b", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                      {tf.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div>
                  <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "5px" }}>Start Date</label>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    style={{ width: "100%", padding: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#e2e8f0", fontSize: "12px", boxSizing: "border-box" }} />
                </div>
                <div>
                  <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "5px" }}>End Date</label>
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    style={{ width: "100%", padding: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#e2e8f0", fontSize: "12px", boxSizing: "border-box" }} />
                </div>
              </div>

              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "5px" }}>Capital: ${capital.toLocaleString()}</label>
                <input type="range" min={100} max={50000} step={100} value={capital} onChange={e => setCapital(Number(e.target.value))} style={{ width: "100%", accentColor: "#3b82f6" }} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                <div>
                  <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "5px" }}>Take Profit: {tp}%</label>
                  <input type="range" min={2} max={100} value={tp} onChange={e => setTp(Number(e.target.value))} style={{ width: "100%", accentColor: "#10b981" }} />
                </div>
                <div>
                  <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "5px" }}>Stop Loss: {sl}%</label>
                  <input type="range" min={1} max={50} value={sl} onChange={e => setSl(Number(e.target.value))} style={{ width: "100%", accentColor: "#f87171" }} />
                </div>
              </div>
            </div>
          </div>

          {/* Strategy Picker */}
          <div style={{ background: "rgba(15,20,30,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", padding: "18px" }}>
            <h3 style={{ fontSize: "13px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "12px" }}>
              Strategy
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {STRATEGIES.map((s, i) => (
                <button key={i} onClick={() => setSelectedStrategy(i)}
                  style={{ padding: "10px 12px", textAlign: "left", background: selectedStrategy === i ? "rgba(59,130,246,0.15)" : "rgba(255,255,255,0.03)", border: `1px solid ${selectedStrategy === i ? "rgba(59,130,246,0.4)" : "rgba(255,255,255,0.06)"}`, borderRadius: "8px", cursor: "pointer" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: selectedStrategy === i ? "#60a5fa" : "#e2e8f0" }}>{s.name}</div>
                  <div style={{ fontSize: "10px", color: "#475569", marginTop: "2px", lineHeight: "1.4" }}>{s.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <button onClick={runSingle} disabled={isRunning}
            style={{ width: "100%", padding: "13px", background: isRunning ? "rgba(59,130,246,0.3)" : "linear-gradient(135deg, #1e40af, #3b82f6)", border: "none", borderRadius: "10px", color: "white", fontWeight: 700, fontSize: "15px", cursor: isRunning ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            {isRunning && !runAll ? <RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={16} />}
            {isRunning && !runAll ? "Running…" : "Run Backtest"}
          </button>

          <button onClick={runAllStrategies} disabled={isRunning}
            style={{ width: "100%", padding: "13px", background: isRunning ? "rgba(124,58,237,0.2)" : "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.35)", borderRadius: "10px", color: "#a78bfa", fontWeight: 700, fontSize: "14px", cursor: isRunning ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            {isRunning && runAll ? <RefreshCw size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Award size={16} />}
            {isRunning && runAll ? "Testing all…" : "Run ALL & Find Best"}
          </button>

          {/* Live stream toggle */}
          <button onClick={toggleStream}
            style={{ width: "100%", padding: "10px", background: streamStatus === "on" ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${streamStatus === "on" ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`, borderRadius: "10px", color: streamStatus === "on" ? "#10b981" : "#64748b", fontWeight: 600, fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            <Activity size={14} />
            {streamStatus === "on" ? `Live: $${(livePrices[symbol] || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "Start Live Price Feed"}
          </button>

          {error && (
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "10px", padding: "10px 12px", color: "#f87171", fontSize: "12px" }}>
              <AlertCircle size={12} style={{ display: "inline", marginRight: "6px", verticalAlign: "middle" }} />{error}
            </div>
          )}
        </div>

        {/* ── RIGHT: Results ──────────────────────────────────────────────── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          {/* Ranking table (when multiple results) */}
          {results.length > 1 && (
            <div style={{ background: "rgba(15,20,30,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", overflow: "hidden" }}>
              <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: "8px" }}>
                <Award size={15} color="#f59e0b" />
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#e2e8f0" }}>Strategy Ranking — {symbol} {timeframe}</span>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                    {["#", "Strategy", "Win Rate", "Profit Factor", "Return", "Sharpe", "Action"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", fontSize: "10px", color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i} onClick={() => setActiveResult(r)} style={{ cursor: "pointer", background: activeResult?.strategy === r.strategy ? "rgba(59,130,246,0.07)" : "transparent", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "10px 12px", fontSize: "13px", fontWeight: 700, color: i === 0 ? "#f59e0b" : "#64748b" }}>
                        {i === 0 ? "🏆" : i + 1}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>{r.strategy}</td>
                      <td style={{ padding: "10px 12px", fontSize: "13px", fontWeight: 700, color: winColor(r.winRate) }}>{r.winRate.toFixed(1)}%</td>
                      <td style={{ padding: "10px 12px", fontSize: "13px", color: r.profitFactor >= 1 ? "#10b981" : "#f87171" }}>{isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : "∞"}</td>
                      <td style={{ padding: "10px 12px", fontSize: "13px", color: r.totalReturnPct >= 0 ? "#10b981" : "#f87171" }}>{r.totalReturnPct >= 0 ? "+" : ""}{r.totalReturnPct.toFixed(1)}%</td>
                      <td style={{ padding: "10px 12px", fontSize: "13px", color: r.sharpeRatio >= 1 ? "#10b981" : "#94a3b8" }}>{r.sharpeRatio.toFixed(2)}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <button onClick={e => { e.stopPropagation(); applyToSniper(r); }}
                          style={{ padding: "5px 10px", background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.35)", borderRadius: "6px", color: "#a78bfa", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>
                          🧪 Save
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Active result detail */}
          {activeResult ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {/* Summary header */}
              <div style={{ background: `linear-gradient(135deg, rgba(${activeResult.totalReturnPct >= 0 ? "16,185,129" : "239,68,68"},0.12), rgba(15,20,30,0.8))`, border: `1px solid rgba(${activeResult.totalReturnPct >= 0 ? "16,185,129" : "239,68,68"},0.25)`, borderRadius: "16px", padding: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
                  <div>
                    <h2 style={{ fontSize: "18px", fontWeight: 800, color: "#e2e8f0", margin: "0 0 4px" }}>{activeResult.strategy}</h2>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>{activeResult.symbol} · {activeResult.timeframe} · {activeResult.startDate} → {activeResult.endDate}</div>
                    <div style={{ fontSize: "11px", color: "#f59e0b", fontWeight: 800, marginTop: "6px" }}>
                      SIMULATED BACKTEST · {activeResult.dataEnvironment === "LIVE_DATA" ? "historical market data" : "synthetic fallback data"} · no exchange fills
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => applyToSniper(activeResult)}
                      style={{ padding: "9px 16px", background: "linear-gradient(135deg, #7C3AED, #4F46E5)", border: "none", borderRadius: "8px", color: "white", fontWeight: 700, fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
                      <Zap size={13} />Save Paper Candidate
                    </button>
                  </div>
                </div>
              </div>

              {/* Key metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px" }}>
                <StatCard label="Win Rate" value={`${activeResult.winRate.toFixed(1)}%`} sub={`${activeResult.trades.filter(t => t.pnlPct > 0).length}W / ${activeResult.trades.filter(t => t.pnlPct <= 0).length}L`} color={winColor(activeResult.winRate)} icon={<Target size={11} />} />
                <StatCard label="Total Return" value={`${activeResult.totalReturnPct >= 0 ? "+" : ""}${activeResult.totalReturnPct.toFixed(1)}%`} sub={`$${(capital * (1 + activeResult.totalReturnPct / 100)).toFixed(0)} final`} color={activeResult.totalReturnPct >= 0 ? "#10b981" : "#f87171"} icon={<TrendingUp size={11} />} />
                <StatCard label="Profit Factor" value={isFinite(activeResult.profitFactor) ? activeResult.profitFactor.toFixed(2) : "∞"} sub="gross profit / gross loss" color={activeResult.profitFactor >= 1.5 ? "#10b981" : activeResult.profitFactor >= 1 ? "#f59e0b" : "#f87171"} icon={<Award size={11} />} />
                <StatCard label="Max Drawdown" value={`-${activeResult.maxDrawdownPct.toFixed(1)}%`} color={activeResult.maxDrawdownPct < 15 ? "#10b981" : activeResult.maxDrawdownPct < 30 ? "#f59e0b" : "#f87171"} icon={<TrendingDown size={11} />} />
                <StatCard label="Sharpe Ratio" value={activeResult.sharpeRatio.toFixed(2)} sub="annualised" color={activeResult.sharpeRatio >= 1 ? "#10b981" : activeResult.sharpeRatio >= 0.5 ? "#f59e0b" : "#f87171"} icon={<Shield size={11} />} />
                <StatCard label="Total Trades" value={String(activeResult.totalTrades)} sub={`Avg win: +${activeResult.avgWinPct.toFixed(1)}%`} icon={<Activity size={11} />} />
              </div>

              {/* Equity curve */}
              <div style={{ background: "rgba(15,20,30,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "16px" }}>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600, marginBottom: "10px" }}>EQUITY CURVE</div>
                <div style={{ overflowX: "auto" }}>
                  <svg width="100%" height="120" viewBox={`0 0 600 120`} preserveAspectRatio="none"
                    style={{ display: "block" }}>
                    {(() => {
                      const data = activeResult.equityCurve;
                      if (data.length < 2) return null;
                      const min = Math.min(...data), max = Math.max(...data);
                      const range = max - min || 1;
                      const W = 600, H = 120;
                      const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 10) - 5}`).join(" ");
                      const color = data[data.length - 1] >= data[0] ? "#10b981" : "#f87171";
                      return (
                        <>
                          <defs>
                            <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                              <stop offset="100%" stopColor={color} stopOpacity="0" />
                            </linearGradient>
                          </defs>
                          <polygon points={`0,${H} ${pts} ${W},${H}`} fill="url(#eq-grad)" />
                          <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
                        </>
                      );
                    })()}
                  </svg>
                </div>
              </div>

              {/* Trade log */}
              <div style={{ background: "rgba(15,20,30,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", overflow: "hidden" }}>
                <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "#e2e8f0" }}>Trade Log ({activeResult.trades.length} trades)</span>
                </div>
                <div style={{ maxHeight: "280px", overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.03)", position: "sticky", top: 0 }}>
                        {["#", "Entry", "Exit", "Entry $", "Exit $", "PnL %", "Exit Reason"].map(h => (
                          <th key={h} style={{ padding: "8px 12px", fontSize: "10px", color: "#475569", fontWeight: 700, textTransform: "uppercase", textAlign: "left" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {activeResult.trades.map((t, i) => (
                        <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                          <td style={{ padding: "8px 12px", fontSize: "12px", color: "#475569" }}>{i + 1}</td>
                          <td style={{ padding: "8px 12px", fontSize: "11px", color: "#94a3b8", fontFamily: "monospace" }}>{new Date(t.entryTime).toLocaleDateString()}</td>
                          <td style={{ padding: "8px 12px", fontSize: "11px", color: "#94a3b8", fontFamily: "monospace" }}>{new Date(t.exitTime).toLocaleDateString()}</td>
                          <td style={{ padding: "8px 12px", fontSize: "12px", color: "#e2e8f0" }}>${t.entryPrice.toFixed(2)}</td>
                          <td style={{ padding: "8px 12px", fontSize: "12px", color: "#e2e8f0" }}>${t.exitPrice.toFixed(2)}</td>
                          <td style={{ padding: "8px 12px", fontSize: "13px", fontWeight: 700, color: t.pnlPct >= 0 ? "#10b981" : "#f87171" }}>
                            {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            <span style={{ fontSize: "10px", padding: "2px 7px", borderRadius: "10px", fontWeight: 600, background: t.exitReason === "tp" ? "rgba(16,185,129,0.15)" : t.exitReason === "sl" ? "rgba(239,68,68,0.15)" : "rgba(100,116,139,0.15)", color: t.exitReason === "tp" ? "#10b981" : t.exitReason === "sl" ? "#f87171" : "#94a3b8" }}>
                              {t.exitReason === "tp" ? "🎯 TP" : t.exitReason === "sl" ? "🛑 SL" : t.exitReason === "signal" ? "↩ Signal" : "⏹ End"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "80px 32px", background: "rgba(15,20,30,0.5)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px", color: "#475569" }}>
              <BarChart2 size={48} style={{ margin: "0 auto 16px", display: "block", opacity: 0.3 }} />
              <div style={{ fontSize: "16px", fontWeight: 600, marginBottom: "8px", color: "#64748b" }}>
                Select a strategy and click Run Backtest
              </div>
              <div style={{ fontSize: "13px" }}>
                Uses LSE's 133B tick archive to test against real historical price action
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
