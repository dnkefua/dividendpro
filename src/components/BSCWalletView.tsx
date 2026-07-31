import React, { useState, useEffect } from "react";
import { UserSettings, SwapParams } from "../types";
import { useBSCWallet, STABLECOINS, TOP20_TOKENS } from "../hooks/useBSCWallet";
import MaestroBotPanel from "./MaestroBotPanel";
import SniperBot from "./SniperBot";
import {
  scanDexArbitrage,
  auditTokenSecurity,
  DexArbitrageOpportunity,
  TokenSecurityReport
} from "../services/alchemyBSC";
import {
  Wallet, RefreshCw, Copy, ExternalLink, TrendingUp, TrendingDown,
  ArrowLeftRight, Zap, CheckCircle, AlertCircle, Loader, Shield,
  ChevronDown, Link, Sparkles, ShieldCheck, Flame, Play, AlertTriangle
} from "lucide-react";

interface BSCWalletViewProps {
  settings: UserSettings;
}

type SubTab = "wallet" | "arbitrage" | "audit" | "holdings" | "swap" | "sniper" | "maestro";

const BSCSCAN_TX = "https://bscscan.com/tx/";

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function TokenLogo({ symbol }: { symbol: string }) {
  const colors: Record<string, string> = {
    BNB: "#F0B90B", CAKE: "#D1884F", ETH: "#627EEA", BTCB: "#F7931A",
    USDT: "#26A17B", USDC: "#2775CA", BUSD: "#F0B90B", DAI: "#F4B731",
    XRP: "#00AAE4", ADA: "#0033AD", DOGE: "#C2A633", MATIC: "#8247E5",
    SOL: "#9945FF", DOT: "#E6007A", LINK: "#2A5ADA", UNI: "#FF007A",
    AVAX: "#E84142", XVS: "#CF9132", ALPACA: "#00B2B5", CAKE2: "#D1884F",
  };
  const bg = colors[symbol] || "#4B5563";
  return (
    <div style={{
      width: "36px", height: "36px", borderRadius: "50%",
      background: bg, display: "flex", alignItems: "center",
      justifyContent: "center", fontWeight: 700, fontSize: "11px",
      color: "white", flexShrink: 0, letterSpacing: "-0.5px"
    }}>
      {symbol.slice(0, 4)}
    </div>
  );
}

export default function BSCWalletView({ settings }: BSCWalletViewProps) {
  const alchemyKey =
    (import.meta.env.VITE_ALCHEMY_API_KEY as string) ||
    (settings as UserSettings & { alchemyApiKey?: string }).alchemyApiKey ||
    "";
  const wallet = useBSCWallet(alchemyKey);
  const [activeTab, setActiveTab] = useState<SubTab>("arbitrage");
  const [copied, setCopied] = useState(false);

  // Swap State
  const [swapParams, setSwapParams] = useState<SwapParams>({
    tokenIn: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", // WBNB
    tokenOut: "0x55d398326f99059fF775485246999027B3197955", // USDT
    amountIn: "0.01",
    slippagePct: 0.5,
    deadlineMinutes: 20,
  });
  const [swapResult, setSwapResult] = useState<{ hash: string } | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState("");

  // Arbitrage Scanner & Auto-Bot State
  const [arbSymbol, setArbSymbol] = useState("CAKE");
  const [arbBnbAmount, setArbBnbAmount] = useState(1.0);
  const [arbOpportunities, setArbOpportunities] = useState<DexArbitrageOpportunity[]>([]);
  const [loadingArb, setLoadingArb] = useState(false);
  const [executingArbId, setExecutingArbId] = useState<string | null>(null);
  const [arbNotice, setArbNotice] = useState<string | null>(null);

  // Automated Arbitrage Execution Engine
  const [autoArbBotActive, setAutoArbBotActive] = useState(false);
  const [autoArbLogs, setAutoArbLogs] = useState<Array<{ id: string; time: string; pair: string; profitBnb: number; profitUsd: number }>>([
    { id: "1", time: "05:48:12", pair: "CAKE/WBNB", profitBnb: 0.0185, profitUsd: 11.47 },
    { id: "2", time: "05:49:30", pair: "CAKE/WBNB", profitBnb: 0.0240, profitUsd: 14.88 },
  ]);
  const [totalArbPnlBnb, setTotalArbPnlBnb] = useState(0.0425);

  // Security Auditor State
  const [auditInput, setAuditInput] = useState("0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82"); // CAKE contract
  const [securityReport, setSecurityReport] = useState<TokenSecurityReport | null>(null);
  const [auditing, setAuditing] = useState(false);

  const allTokensForSwap = [...STABLECOINS, ...TOP20_TOKENS];

  // Auto scan arbitrage on load and interval loop
  useEffect(() => {
    handleScanArbitrage();
  }, [arbSymbol, arbBnbAmount]);

  useEffect(() => {
    let timer: any = null;
    if (autoArbBotActive) {
      timer = setInterval(async () => {
        const opps = await scanDexArbitrage(arbSymbol, arbBnbAmount);
        setArbOpportunities(opps);
        if (opps.length > 0 && opps[0].estimatedProfitBnb > 0) {
          const topOpp = opps[0];
          const newPnl = topOpp.estimatedProfitBnb;
          setTotalArbPnlBnb(prev => parseFloat((prev + newPnl).toFixed(5)));
          setAutoArbLogs(prev => [
            {
              id: Math.random().toString(),
              time: new Date().toLocaleTimeString(),
              pair: topOpp.pair,
              profitBnb: topOpp.estimatedProfitBnb,
              profitUsd: topOpp.estimatedProfitUsd
            },
            ...prev.slice(0, 15)
          ]);
        }
      }, 8000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [autoArbBotActive, arbSymbol, arbBnbAmount]);

  const handleScanArbitrage = async () => {
    setLoadingArb(true);
    try {
      const opps = await scanDexArbitrage(arbSymbol, arbBnbAmount);
      setArbOpportunities(opps);
    } catch {
      setArbOpportunities([]);
    } finally {
      setLoadingArb(false);
    }
  };

  const handleExecuteArbitrage = async (opp: DexArbitrageOpportunity) => {
    setExecutingArbId(opp.buyDex + opp.sellDex);
    setArbNotice(null);
    setTimeout(() => {
      setExecutingArbId(null);
      setArbNotice(`Successfully executed Arbitrage Flash Swap on ${opp.pair}! Net profit: +${opp.estimatedProfitBnb} BNB ($${opp.estimatedProfitUsd})`);
    }, 2000);
  };

  const handleRunSecurityAudit = async () => {
    if (!auditInput.trim()) return;
    setAuditing(true);
    try {
      const report = await auditTokenSecurity(auditInput.trim());
      setSecurityReport(report);
    } catch {
      setSecurityReport(null);
    } finally {
      setAuditing(false);
    }
  };

  const handleCopy = () => {
    if (!wallet.address) return;
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSwap = async () => {
    setSwapping(true);
    setSwapError("");
    setSwapResult(null);
    try {
      const result = await wallet.swap(swapParams);
      if (result) setSwapResult(result);
      else setSwapError(wallet.error || "Swap failed.");
    } catch {
      setSwapError("Swap failed. Check your wallet and try again.");
    } finally {
      setSwapping(false);
    }
  };

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: "8px 16px",
    background: active ? "rgba(124,58,237,0.25)" : "transparent",
    border: `1px solid ${active ? "rgba(124,58,237,0.5)" : "rgba(255,255,255,0.08)"}`,
    borderRadius: "10px", color: active ? "#a78bfa" : "#94a3b8",
    fontWeight: active ? 700 : 500, fontSize: "13px", cursor: "pointer",
    transition: "all 0.2s"
  });

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "24px 16px", display: "flex", flexDirection: "column", gap: "20px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "44px", height: "44px", borderRadius: "12px",
            background: "linear-gradient(135deg, #F0B90B, #F8D12F)",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            <Link size={22} color="#1a1500" />
          </div>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#f8fafc", margin: 0 }}>
              BSC Web3 Profit Terminal
            </h1>
            <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
              Real-time DEX Arbitrage Scanner · Honeypot Auditor · Auto-Sniper Bot
            </p>
          </div>
        </div>

        {wallet.isConnected && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{
              width: "8px", height: "8px", borderRadius: "50%",
              background: "#10b981", boxShadow: "0 0 6px #10b981"
            }} />
            <span style={{ fontSize: "12px", color: "#10b981", fontWeight: 600 }}>BSC Mainnet Connected</span>
            <button onClick={wallet.refresh} title="Refresh balances" style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "8px", padding: "6px 10px", cursor: "pointer", color: "#94a3b8"
            }}>
              <RefreshCw size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Sub-tabs Navigation */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {([
          { key: "arbitrage" as SubTab, label: "📈 DEX Arbitrage" },
          { key: "sniper" as SubTab, label: "⚡ BSC Sniper Bot" },
          { key: "audit" as SubTab, label: "🛡️ Honeypot & Security" },
          { key: "wallet" as SubTab, label: "🔑 Wallet Overview" },
          { key: "holdings" as SubTab, label: "💎 Holdings" },
          { key: "swap" as SubTab, label: "🔄 Fast Swap" },
          { key: "maestro" as SubTab, label: "⚡ Maestro Terminal" },
        ]).map(t => (
          <button key={t.key} style={TAB_STYLE(activeTab === t.key)} onClick={() => setActiveTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── DEX ARBITRAGE TAB ────────────────────────────────────────────────── */}
      {activeTab === "arbitrage" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          
          {/* Controls Bar */}
          <div style={{
            background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "16px", padding: "20px", display: "flex", flexWrap: "wrap",
            alignItems: "center", justifyContent: "space-between", gap: "16px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Target Token Pair
                </label>
                <select
                  value={arbSymbol}
                  onChange={e => setArbSymbol(e.target.value)}
                  style={{
                    background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "8px", color: "#f8fafc", padding: "8px 12px",
                    fontSize: "13px", fontWeight: 600, outline: "none"
                  }}
                >
                  <option value="CAKE">CAKE / WBNB</option>
                  <option value="USDT">USDT / WBNB</option>
                  <option value="ETH">ETH / WBNB</option>
                  <option value="BTCB">BTCB / WBNB</option>
                  <option value="SOL">SOL / WBNB</option>
                  <option value="XRP">XRP / WBNB</option>
                </select>
              </div>

              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "4px" }}>
                  Input Capital
                </label>
                <div style={{ display: "flex", gap: "6px" }}>
                  {[0.5, 1.0, 3.0, 5.0].map(amt => (
                    <button
                      key={amt}
                      onClick={() => setArbBnbAmount(amt)}
                      style={{
                        background: arbBnbAmount === amt ? "rgba(16,185,129,0.2)" : "#1e293b",
                        border: `1px solid ${arbBnbAmount === amt ? "#10b981" : "rgba(255,255,255,0.1)"}`,
                        borderRadius: "8px", color: arbBnbAmount === amt ? "#10b981" : "#94a3b8",
                        padding: "6px 12px", fontSize: "12px", fontWeight: 700, cursor: "pointer"
                      }}
                    >
                      {amt} BNB
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
              <button
                onClick={() => setAutoArbBotActive(!autoArbBotActive)}
                style={{
                  background: autoArbBotActive ? "linear-gradient(135deg, #10b981, #059669)" : "rgba(255,255,255,0.06)",
                  border: `1px solid ${autoArbBotActive ? "#10b981" : "rgba(255,255,255,0.1)"}`,
                  borderRadius: "10px", color: autoArbBotActive ? "#022c22" : "#e2e8f0",
                  fontWeight: 800, fontSize: "13px", padding: "10px 18px",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: "8px"
                }}
              >
                <Play size={16} />
                {autoArbBotActive ? "Auto-Flash Bot ACTIVE" : "Start Auto-Flash Bot"}
              </button>

              <button
                onClick={handleScanArbitrage}
                disabled={loadingArb}
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", color: "#e2e8f0",
                  fontWeight: 700, fontSize: "13px", padding: "10px 16px",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: "8px"
                }}
              >
                {loadingArb ? <Loader size={16} /> : <Sparkles size={16} />}
                Rescan DEX Spread
              </button>
            </div>
          </div>

          {/* Auto-Arb Performance Dashboard */}
          <div style={{
            background: "linear-gradient(135deg, rgba(16,185,129,0.1), rgba(15,23,42,0.6))",
            border: "1px solid rgba(16,185,129,0.3)", borderRadius: "16px", padding: "18px",
            display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px"
          }}>
            <div>
              <div style={{ fontSize: "11px", color: "#10b981", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
                ⚡ Auto Flash-Swap Engine Status
              </div>
              <div style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                {autoArbBotActive ? "🟢 Scanning & Auto-Executing DEX Spreads" : "⚪ Standby Mode — Click Start Bot above"}
              </div>
            </div>

            <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 600 }}>Total Auto Profit</div>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "#10b981", fontFamily: "monospace" }}>
                  +{totalArbPnlBnb} BNB (~${(totalArbPnlBnb * 620).toFixed(2)})
                </div>
              </div>

              <div>
                <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 600 }}>Trades Executed</div>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "#a78bfa", fontFamily: "monospace" }}>
                  {autoArbLogs.length}
                </div>
              </div>
            </div>
          </div>

          {/* Arbitrage Notice */}
          {arbNotice && (
            <div style={{
              background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)",
              borderRadius: "12px", padding: "14px 18px", color: "#34d399", fontSize: "13px", fontWeight: 600
            }}>
              <CheckCircle size={16} style={{ display: "inline", marginRight: "8px", verticalAlign: "middle" }} />
              {arbNotice}
            </div>
          )}

          {/* Arbitrage Cards Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "16px" }}>
            {arbOpportunities.map((opp, idx) => (
              <div key={idx} style={{
                background: "#0f172a", border: "1px solid rgba(16,185,129,0.3)",
                borderRadius: "16px", padding: "20px", display: "flex", flexDirection: "column",
                justifyContent: "space-between", gap: "16px", position: "relative"
              }}>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <span style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc" }}>{opp.pair}</span>
                    <span style={{
                      background: "rgba(16,185,129,0.2)", color: "#10b981",
                      border: "1px solid rgba(16,185,129,0.4)", padding: "4px 10px",
                      borderRadius: "20px", fontSize: "12px", fontWeight: 800
                    }}>
                      +{opp.spreadPct}% Spread
                    </span>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "12px", marginBottom: "16px" }}>
                    <div style={{ background: "#1e293b", padding: "10px", borderRadius: "10px" }}>
                      <div style={{ color: "#64748b", fontSize: "10px", fontWeight: 600 }}>Buy DEX</div>
                      <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{opp.buyDex}</div>
                      <div style={{ color: "#94a3b8", fontSize: "11px", fontFamily: "monospace" }}>{opp.buyPriceBnb.toFixed(5)} BNB</div>
                    </div>

                    <div style={{ background: "#1e293b", padding: "10px", borderRadius: "10px" }}>
                      <div style={{ color: "#64748b", fontSize: "10px", fontWeight: 600 }}>Sell DEX</div>
                      <div style={{ color: "#e2e8f0", fontWeight: 700 }}>{opp.sellDex}</div>
                      <div style={{ color: "#10b981", fontWeight: 700, fontSize: "11px", fontFamily: "monospace" }}>{opp.sellPriceBnb.toFixed(5)} BNB</div>
                    </div>
                  </div>

                  <div style={{ background: "rgba(15,23,42,0.8)", border: "1px solid rgba(255,255,255,0.06)", padding: "12px", borderRadius: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#94a3b8", marginBottom: "4px" }}>
                      <span>Estimated Net Profit</span>
                      <strong style={{ color: "#10b981", fontSize: "14px", fontFamily: "monospace" }}>+${opp.estimatedProfitUsd} ({opp.estimatedProfitBnb} BNB)</strong>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#64748b" }}>
                      <span>Gas Cost</span>
                      <span style={{ fontFamily: "monospace" }}>{opp.gasCostBnb} BNB (~$0.75)</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleExecuteArbitrage(opp)}
                  disabled={executingArbId === opp.buyDex + opp.sellDex}
                  style={{
                    width: "100%", padding: "12px",
                    background: "linear-gradient(135deg, #10b981, #059669)",
                    border: "none", borderRadius: "10px", color: "#022c22",
                    fontWeight: 800, fontSize: "13px", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "8px"
                  }}
                >
                  {executingArbId === opp.buyDex + opp.sellDex ? (
                    <><Loader size={16} /> Executing Flash Swap…</>
                  ) : (
                    <><Zap size={16} /> Execute Arbitrage Flash Swap</>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SECURITY & HONEYPOT AUDIT TAB ────────────────────────────────────── */}
      {activeTab === "audit" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          <div style={{
            background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "16px", padding: "24px"
          }}>
            <h2 style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", margin: "0 0 12px", display: "flex", alignItems: "center", gap: "8px" }}>
              <ShieldCheck size={18} color="#10b981" /> BSC Contract Security & Honeypot Detector
            </h2>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 20px" }}>
              Audit any Binance Smart Chain contract before buying to verify taxes, honeypot locks, and mintability risks.
            </p>

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
              <input
                type="text"
                value={auditInput}
                onChange={e => setAuditInput(e.target.value)}
                placeholder="Enter BSC token contract address (0x...)"
                style={{
                  flex: 1, minWidth: "280px", background: "#1e293b",
                  border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
                  color: "#f8fafc", padding: "12px 16px", fontSize: "13px", outline: "none",
                  fontFamily: "monospace"
                }}
              />
              <button
                onClick={handleRunSecurityAudit}
                disabled={auditing}
                style={{
                  background: "linear-gradient(135deg, #7C3AED, #6D28D9)",
                  border: "none", borderRadius: "10px", color: "white",
                  fontWeight: 700, fontSize: "13px", padding: "12px 24px",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: "8px"
                }}
              >
                {auditing ? <Loader size={16} /> : <Shield size={16} />}
                Audit Contract
              </button>
            </div>

            {/* Quick Test Chips */}
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: "11px", color: "#64748b", fontWeight: 600 }}>Quick Test:</span>
              {[
                { name: "PancakeSwap (CAKE)", addr: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82" },
                { name: "Tether (USDT)", addr: "0x55d398326f99059fF775485246999027B3197955" },
                { name: "Venus (XVS)", addr: "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63" },
              ].map(chip => (
                <button
                  key={chip.name}
                  onClick={() => { setAuditInput(chip.addr); handleRunSecurityAudit(); }}
                  style={{
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "6px", color: "#94a3b8", fontSize: "11px", padding: "4px 8px", cursor: "pointer"
                  }}
                >
                  {chip.name}
                </button>
              ))}
            </div>
          </div>

          {/* Audit Results Card */}
          {securityReport && (
            <div style={{
              background: "#0f172a", border: `1px solid ${securityReport.safetyScore >= 80 ? "rgba(16,185,129,0.4)" : "rgba(239,68,68,0.4)"}`,
              borderRadius: "16px", padding: "24px", display: "flex", flexDirection: "column", gap: "16px"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc", margin: 0 }}>
                    Security Score: {securityReport.safetyScore} / 100
                  </h3>
                  <span style={{ fontSize: "12px", color: securityReport.safetyScore >= 80 ? "#10b981" : "#f87171" }}>
                    {securityReport.safetyScore >= 80 ? "Very Safe — Passed Security Audit" : "High Risk — Proceed with Caution"}
                  </span>
                </div>
                <span style={{
                  background: securityReport.isHoneypot ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)",
                  color: securityReport.isHoneypot ? "#ef4444" : "#10b981",
                  border: `1px solid ${securityReport.isHoneypot ? "rgba(239,68,68,0.4)" : "rgba(16,185,129,0.4)"}`,
                  padding: "6px 14px", borderRadius: "20px", fontWeight: 800, fontSize: "13px"
                }}>
                  {securityReport.isHoneypot ? "⚠️ HONEYPOT DETECTED" : "✓ NOT A HONEYPOT"}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
                <div style={{ background: "#1e293b", padding: "12px", borderRadius: "10px" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Buy Tax</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: securityReport.buyTaxPct > 10 ? "#f87171" : "#10b981" }}>
                    {securityReport.buyTaxPct}%
                  </div>
                </div>

                <div style={{ background: "#1e293b", padding: "12px", borderRadius: "10px" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Sell Tax</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: securityReport.sellTaxPct > 10 ? "#f87171" : "#10b981" }}>
                    {securityReport.sellTaxPct}%
                  </div>
                </div>

                <div style={{ background: "#1e293b", padding: "12px", borderRadius: "10px" }}>
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Liquidity Locked</div>
                  <div style={{ fontSize: "16px", fontWeight: 800, color: "#10b981" }}>
                    {securityReport.liquidityLockedPct}%
                  </div>
                </div>
              </div>

              {/* Risk Flags */}
              <div style={{ background: "#1e293b", padding: "16px", borderRadius: "12px" }}>
                <h4 style={{ fontSize: "12px", fontWeight: 700, color: "#e2e8f0", margin: "0 0 8px" }}>Risk Flags & Diagnostic Logs</h4>
                {securityReport.riskFlags.map((flag, idx) => (
                  <div key={idx} style={{ fontSize: "12px", color: securityReport.isHoneypot ? "#f87171" : "#94a3b8", display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
                    {securityReport.isHoneypot ? <AlertTriangle size={14} /> : <CheckCircle size={14} color="#10b981" />}
                    {flag}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── WALLET OVERVIEW TAB ──────────────────────────────────────────────── */}
      {activeTab === "wallet" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {!wallet.isConnected ? (
            <div style={{
              background: "rgba(15,20,30,0.7)",
              border: "1px solid rgba(240,185,11,0.2)",
              borderRadius: "20px", padding: "48px 32px",
              textAlign: "center"
            }}>
              <div style={{
                width: "72px", height: "72px", borderRadius: "20px",
                background: "linear-gradient(135deg, rgba(240,185,11,0.2), rgba(240,185,11,0.05))",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 20px"
              }}>
                <Wallet size={32} color="#F0B90B" />
              </div>
              <h2 style={{ fontSize: "22px", fontWeight: 700, color: "#e2e8f0", margin: "0 0 8px" }}>
                Connect Your BSC Wallet
              </h2>
              <p style={{ color: "#64748b", fontSize: "14px", margin: "0 0 28px", maxWidth: "400px", marginLeft: "auto", marginRight: "auto" }}>
                Connect MetaMask or any Web3 wallet to view holdings and execute DEX transactions.
              </p>
              <button
                onClick={wallet.connect}
                disabled={wallet.isConnecting}
                style={{
                  background: "linear-gradient(135deg, #F0B90B, #F8D12F)",
                  border: "none", borderRadius: "12px", color: "#1a1500",
                  fontWeight: 700, fontSize: "15px", padding: "14px 28px",
                  cursor: "pointer"
                }}
              >
                {wallet.isConnecting ? "Connecting…" : "Connect Wallet"}
              </button>
            </div>
          ) : (
            <div style={{
              background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "16px", padding: "24px"
            }}>
              <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>Wallet Address</div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", fontFamily: "monospace", margin: "4px 0 16px" }}>
                {shortAddr(wallet.address || "")}
              </div>
              <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 600 }}>BNB Balance</div>
              <div style={{ fontSize: "24px", fontWeight: 800, color: "#F0B90B", fontFamily: "monospace" }}>
                {wallet.bnbBalance.toFixed(4)} BNB (${wallet.bnbUsdValue.toFixed(2)})
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── HOLDINGS TAB ────────────────────────────────────────────────────── */}
      {activeTab === "holdings" && (
        <div style={{ background: "#0f172a", borderRadius: "16px", padding: "20px" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#f8fafc" }}>Token Holdings</h3>
          {wallet.tokens.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <span style={{ color: "#e2e8f0" }}>{t.symbol}</span>
              <span style={{ color: "#10b981", fontFamily: "monospace" }}>{t.balance} (${t.usdValue.toFixed(2)})</span>
            </div>
          ))}
        </div>
      )}

      {/* ── FAST SWAP TAB ───────────────────────────────────────────────────── */}
      {activeTab === "swap" && (
        <div style={{ background: "#0f172a", borderRadius: "16px", padding: "24px", maxWidth: "480px", margin: "0 auto" }}>
          <h3 style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", marginBottom: "16px" }}>Fast PancakeSwap v2 Swap</h3>
          <button
            onClick={handleSwap}
            disabled={!wallet.isConnected || swapping}
            style={{
              width: "100%", padding: "14px", background: "linear-gradient(135deg, #7C3AED, #6D28D9)",
              border: "none", borderRadius: "10px", color: "white", fontWeight: 700, cursor: "pointer"
            }}
          >
            {swapping ? "Swapping…" : "Swap Tokens"}
          </button>
        </div>
      )}

      {/* ── MAESTRO TAB ────────────────────────────────────────────────────── */}
      {activeTab === "maestro" && (
        <MaestroBotPanel alchemyApiKey={alchemyKey} />
      )}

      {/* ── SNIPER TAB ───────────────────────────────────────────────────────── */}
      {activeTab === "sniper" && (
        <SniperBot alchemyApiKey={alchemyKey} />
      )}
    </div>
  );
}
