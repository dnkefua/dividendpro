import React, { useState, useEffect } from "react";
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

type SubTab = "wallet" | "arbitrage" | "audit" | "holdings" | "swap" | "sniper" | "maestro";

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

export default function BSCWalletView() {
  const wallet = useBSCWallet();
  const [activeTab, setActiveTab] = useState<SubTab>("arbitrage");
  const [copied, setCopied] = useState(false);
  const [showFundingModal, setShowFundingModal] = useState(false);

  // Arbitrage Scanner & Auto-Bot State
  const [arbSymbol, setArbSymbol] = useState("CAKE");
  const [arbBnbAmount, setArbBnbAmount] = useState(1.0);
  const [arbOpportunities, setArbOpportunities] = useState<DexArbitrageOpportunity[]>([]);
  const [loadingArb, setLoadingArb] = useState(false);
  const [executingArbId, setExecutingArbId] = useState<string | null>(null);
  const [arbNotice, setArbNotice] = useState<string | null>(null);

  // Explicit paper-only arbitrage scanner. No flash-loan executor is configured.
  const [autoArbBotActive, setAutoArbBotActive] = useState(false);
  const [autoArbLogs, setAutoArbLogs] = useState<Array<{ id: string; time: string; pair: string; profitBnb: number; profitUsd: number }>>([]);
  const [totalArbPnlBnb, setTotalArbPnlBnb] = useState(0);

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
    setArbNotice(`No transaction submitted. ${opp.pair} is a ${opp.environment === "LIVE_DATA" ? "live-data quote" : "simulated fallback"}; a verified atomic flash-swap executor is not configured.`);
    setExecutingArbId(null);
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
              BSC Web3 Execution & Evidence Terminal
            </h1>
            <p style={{ fontSize: "13px", color: "#64748b", margin: 0 }}>
              DEX quote scanner · fail-closed token screening · explicitly signed wallet actions
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

      {/* Wallet readiness banner */}
      <div style={{
        background: "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(99,102,241,0.15))",
        border: "1px solid rgba(16,185,129,0.4)",
        borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Wallet size={24} color="#10b981" />
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", margin: 0 }}>
                Review Wallet Readiness
              </h3>
              <p style={{ fontSize: "12px", color: "#94a3b8", margin: "2px 0 0 0" }}>
                Funding does not activate automation. Only explicitly signed transactions can move funds; the arbitrage scanner is paper-only.
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowFundingModal(true)}
            style={{
              padding: "10px 18px", background: "linear-gradient(135deg, #10b981, #059669)",
              border: "none", borderRadius: "12px", color: "white", fontWeight: 800,
              fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px"
            }}
          >
            <Sparkles size={16} /> 1-Click Deposit & Fund Wallet
          </button>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", background: "#090d16", padding: "12px 16px", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.08)" }}>
          <span style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8" }}>BSC Deposit Address:</span>
          <span style={{ fontSize: "12px", fontFamily: "monospace", color: "#f8fafc", fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
            {wallet.address || "0x71C765E12A832109841B9200428190345718976F"}
          </span>
          <button
            onClick={handleCopy}
            style={{
              padding: "6px 12px", background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "8px", color: "#e2e8f0", fontSize: "11px", fontWeight: 700, cursor: "pointer"
            }}
          >
            {copied ? "Copied! ✓" : "Copy Address"}
          </button>
        </div>
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
                {autoArbBotActive ? "Paper Spread Scanner ACTIVE" : "Start Paper Spread Scanner"}
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
                🧪 Paper Spread Scanner Status
              </div>
              <div style={{ fontSize: "18px", fontWeight: 800, color: "#f8fafc" }}>
                {autoArbBotActive ? "Scanning quotes — no transactions submitted" : "Standby — paper-only scanner"}
              </div>
            </div>

            <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 600 }}>Cumulative Model PnL</div>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "#10b981", fontFamily: "monospace" }}>
                  +{totalArbPnlBnb} BNB (~${(totalArbPnlBnb * 620).toFixed(2)})
                </div>
              </div>

              <div>
                <div style={{ fontSize: "10px", color: "#64748b", fontWeight: 600 }}>Paper Samples</div>
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
                    <span style={{ marginLeft: "8px", color: opp.environment === "LIVE_DATA" ? "#60a5fa" : "#f59e0b", fontSize: "10px", fontWeight: 800 }}>
                      {opp.environment === "LIVE_DATA" ? "LIVE QUOTE" : "SIMULATED FALLBACK"}
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
                      <span>Modelled Net PnL</span>
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
                  <><Zap size={16} /> Explain Execution Availability</>
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
              <ShieldCheck size={18} color="#10b981" /> BSC Honeypot Oracle Screen
            </h2>
            <p style={{ fontSize: "13px", color: "#64748b", margin: "0 0 20px" }}>
              Query reported buy/sell taxes and honeypot signals. This limited oracle screen does not verify liquidity locks, ownership, proxy behavior, or mintability.
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
                Run Oracle Screen
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
                    Oracle Screen Score: {securityReport.safetyScore} / 100
                  </h3>
                  <span style={{ fontSize: "12px", color: securityReport.safetyScore >= 80 ? "#10b981" : "#f87171" }}>
                    {securityReport.safetyScore >= 80 ? "No honeypot signal reported — not a full audit" : "Oracle unavailable or risk signal reported — execution remains blocked"}
                  </span>
                </div>
                <span style={{
                  background: securityReport.isHoneypot ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)",
                  color: securityReport.isHoneypot ? "#ef4444" : "#10b981",
                  border: `1px solid ${securityReport.isHoneypot ? "rgba(239,68,68,0.4)" : "rgba(16,185,129,0.4)"}`,
                  padding: "6px 14px", borderRadius: "20px", fontWeight: 800, fontSize: "13px"
                }}>
                  {securityReport.isHoneypot ? "⚠️ HONEYPOT SIGNAL REPORTED" : "LIMITED SCREEN — NO SIGNAL REPORTED"}
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
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Liquidity Lock</div>
                  <div style={{ fontSize: "13px", fontWeight: 800, color: "#f59e0b" }}>
                    Not evaluated
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
          <h3 style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", marginBottom: "8px" }}>PancakeSwap v2 Execution</h3>
          <p style={{ color: "#94a3b8", fontSize: "12px", lineHeight: 1.5 }}>
            Disabled for this release. A router-specific receipt and token-delta reconciler must be deployed before swaps can move funds.
          </p>
          <button
            disabled
            style={{
              width: "100%", padding: "14px", background: "linear-gradient(135deg, #7C3AED, #6D28D9)",
              border: "none", borderRadius: "10px", color: "white", fontWeight: 700, cursor: "not-allowed", opacity: 0.5
            }}
          >
            Execution Unavailable
          </button>
        </div>
      )}

      {/* ── MAESTRO TAB ────────────────────────────────────────────────────── */}
      {activeTab === "maestro" && (
        <MaestroBotPanel />
      )}

      {/* ── SNIPER TAB ───────────────────────────────────────────────────────── */}
      {activeTab === "sniper" && (
        <SniperBot />
      )}

      {/* ── LIVE DEPOSIT & FUNDING WIZARD MODAL ────────────────────────── */}
      {showFundingModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
          backdropFilter: "blur(8px)", zIndex: 100, display: "flex",
          alignItems: "center", justifyContent: "center", padding: "16px"
        }}>
          <div style={{
            background: "#0f172a", border: "1px solid rgba(16,185,129,0.5)",
            borderRadius: "24px", maxWidth: "520px", width: "100%", padding: "28px",
            display: "flex", flexDirection: "column", gap: "20px", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <Sparkles color="#10b981" size={24} />
                <h3 style={{ fontSize: "18px", fontWeight: 900, color: "#f8fafc", margin: 0 }}>
                  Wallet Funding Safety Checklist
                </h3>
              </div>
              <button
                onClick={() => setShowFundingModal(false)}
                style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: "20px", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", background: "#030712", padding: "16px", borderRadius: "16px", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ fontSize: "11px", fontWeight: 800, color: "#10b981", textTransform: "uppercase" }}>
                1. Connected BSC Wallet Address (BEP-20)
              </div>
              <div style={{ fontSize: "13px", fontFamily: "monospace", color: "#f8fafc", fontWeight: 700, wordBreak: "break-all" }}>
                {wallet.address || "0x71C765E12A832109841B9200428190345718976F"}
              </div>
              <button
                onClick={handleCopy}
                style={{
                  padding: "10px", background: "linear-gradient(135deg, #10b981, #059669)",
                  border: "none", borderRadius: "10px", color: "white", fontWeight: 800, fontSize: "12px", cursor: "pointer"
                }}
              >
                {copied ? "Copied to Clipboard! ✓" : "Copy Wallet Address"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "12px", color: "#cbd5e1", lineHeight: "1.6" }}>
              <div style={{ fontWeight: 800, color: "#f8fafc", fontSize: "13px" }}>2. Deposit Instructions (from Binance, MetaMask, or Trust Wallet):</div>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <span style={{ background: "rgba(16,185,129,0.2)", color: "#10b981", padding: "2px 8px", borderRadius: "6px", fontWeight: 800 }}>A</span>
                <span>Send <strong>BNB</strong> (BEP-20) to cover gas fees (Recommended: 0.05 BNB min).</span>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <span style={{ background: "rgba(16,185,129,0.2)", color: "#10b981", padding: "2px 8px", borderRadius: "6px", fontWeight: 800 }}>B</span>
                <span>Only send <strong>USDT / WBNB</strong> if you independently intend to hold those assets in this wallet. No automated arbitrage executor is configured.</span>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                <span style={{ background: "rgba(16,185,129,0.2)", color: "#10b981", padding: "2px 8px", borderRadius: "6px", fontWeight: 800 }}>C</span>
                <span>For the verified path, use <strong>Quant Alpha Hub → Verified USDT Transfer</strong>, inspect the wallet prompt, and require the BscScan evidence link.</span>
              </div>
            </div>

            <button
              onClick={() => setShowFundingModal(false)}
              style={{
                padding: "12px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: "12px", color: "#f8fafc", fontWeight: 800, fontSize: "13px", cursor: "pointer"
              }}
            >
              Done & Close Wizard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
