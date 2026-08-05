import React, { useState, useEffect } from "react";
import {
  checkHummingbotGatewayHealth,
  DEFAULT_LOCAL_GATEWAY_URL,
  CLOUD_RUN_GATEWAY_URL,
  HummingbotGatewayStatus,
  HummingbotBotStatus
} from "../services/hummingbotService";
import {
  Bot, Cpu, Activity, RefreshCw, Zap, Shield, Play, Square,
  CheckCircle2, AlertTriangle, Layers, ArrowUpRight, Server, Terminal, Send
} from "lucide-react";

export default function HummingbotView() {
  const [gatewayUrl, setGatewayUrl] = useState(CLOUD_RUN_GATEWAY_URL);
  const [gatewayStatus, setGatewayStatus] = useState<HummingbotGatewayStatus | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [bots, setBots] = useState<HummingbotBotStatus[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    handleCheckHealth();
  }, []);

  const handleCheckHealth = async () => {
    setLoadingHealth(true);
    const status = await checkHummingbotGatewayHealth(gatewayUrl);
    setGatewayStatus(status);
    setLoadingHealth(false);
  };

  const handleToggleBot = (botId: string) => {
    const bot = bots.find(candidate => candidate.id === botId);
    setNotice(
      gatewayStatus?.connected
        ? `No action sent for "${bot?.name ?? botId}": authenticated Hummingbot start/stop endpoints are not configured.`
        : "No action sent: Hummingbot Gateway is offline or unverified.",
    );
  };

  const handleLaunchStrategy = (name: string, strategyType: "CEX_DEX_ARBITRAGE" | "PURE_MARKET_MAKING" | "LIQUIDITY_MINING", pair: string, primaryExchange: string, secondaryExchange?: string) => {
    void strategyType; void pair; void primaryExchange; void secondaryExchange;
    setNotice(
      gatewayStatus?.connected
        ? `Strategy "${name}" was not launched: authenticated Hummingbot create/start endpoints are not configured yet.`
        : `Strategy "${name}" was not launched: the Hummingbot Gateway is offline or unverified.`,
    );
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 16px", display: "flex", flexDirection: "column", gap: "24px" }}>
      
      {/* Top Header Banner */}
      <div style={{
        background: "linear-gradient(135deg, rgba(79,70,229,0.18), rgba(124,58,237,0.15))",
        border: "1px solid rgba(79,70,229,0.4)",
        borderRadius: "20px", padding: "26px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: "16px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div style={{
            width: "48px", height: "48px", borderRadius: "14px",
            background: "linear-gradient(135deg, #4F46E5, #7C3AED)",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            <Bot size={26} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: 900, color: "#f8fafc", margin: 0 }}>
              Hummingbot Gateway — Research Only
            </h1>
            <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
              Offline. No bots are running or profits being generated. Connect requires authenticated endpoints.
            </p>
          </div>
        </div>

        <button
          onClick={handleCheckHealth}
          disabled={loadingHealth}
          style={{
            padding: "12px 20px", background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px",
            color: "#e2e8f0", fontWeight: 800, fontSize: "13px", cursor: "pointer",
            display: "flex", alignItems: "center", gap: "8px"
          }}
        >
          <RefreshCw size={16} className={loadingHealth ? "animate-spin" : ""} />
          Check Gateway Health
        </button>
      </div>

      {/* Gateway Connection Banner */}
      <div style={{
        background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Server size={18} color="#a78bfa" />
            <span style={{ fontSize: "14px", fontWeight: 800, color: "#f8fafc" }}>Hummingbot Gateway REST API Config</span>
          </div>

          <span style={{
            background: gatewayStatus?.connected ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)",
            border: `1px solid ${gatewayStatus?.connected ? "#10b981" : "#f59e0b"}`,
            color: gatewayStatus?.connected ? "#10b981" : "#f59e0b",
            padding: "4px 12px", borderRadius: "20px", fontSize: "11px", fontWeight: 900
          }}>
            {gatewayStatus?.connected ? `🟢 HEALTH ENDPOINT REACHABLE (${gatewayStatus.latencyMs}ms)` : "🔴 GATEWAY OFFLINE / UNVERIFIED"}
          </span>
        </div>

        {/* Endpoint Preset Buttons */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            onClick={() => setGatewayUrl(CLOUD_RUN_GATEWAY_URL)}
            style={{
              padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 800, cursor: "pointer",
              background: gatewayUrl === CLOUD_RUN_GATEWAY_URL ? "linear-gradient(135deg, #10b981, #059669)" : "#1e293b",
              color: gatewayUrl === CLOUD_RUN_GATEWAY_URL ? "#022c22" : "#94a3b8", border: "none"
            }}
          >
            ☁️ Google Cloud Run (24/7 Cloud Host)
          </button>
          <button
            onClick={() => setGatewayUrl(DEFAULT_LOCAL_GATEWAY_URL)}
            style={{
              padding: "6px 12px", borderRadius: "8px", fontSize: "11px", fontWeight: 800, cursor: "pointer",
              background: gatewayUrl === DEFAULT_LOCAL_GATEWAY_URL ? "linear-gradient(135deg, #7C3AED, #4F46E5)" : "#1e293b",
              color: gatewayUrl === DEFAULT_LOCAL_GATEWAY_URL ? "white" : "#94a3b8", border: "none"
            }}
          >
            💻 Local Docker (http://localhost:15888)
          </button>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            value={gatewayUrl}
            onChange={(e) => setGatewayUrl(e.target.value)}
            placeholder="http://localhost:15888"
            style={{
              flex: 1, minWidth: "260px", padding: "10px 14px", background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px",
              color: "#f8fafc", fontFamily: "monospace", fontSize: "13px"
            }}
          />
          <button
            onClick={handleCheckHealth}
            style={{
              padding: "10px 18px", background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
              border: "none", borderRadius: "10px", color: "white", fontWeight: 800,
              fontSize: "13px", cursor: "pointer"
            }}
          >
            Connect REST Gateway
          </button>
        </div>
      </div>

      {/* Notice Alert */}
      {notice && (
        <div style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.4)", borderRadius: "12px", padding: "14px", color: "#34d399", fontSize: "13px", fontWeight: 700 }}>
          <CheckCircle2 size={16} style={{ display: "inline", marginRight: "6px", verticalAlign: "middle" }} />
          {notice}
        </div>
      )}

      {/* 🛡️ LUMINA HUMMINGBOT WINNING PROTECTION MATRIX */}
      <div style={{
        background: "#090d16", border: "1px solid rgba(16,185,129,0.4)",
        borderRadius: "20px", padding: "22px", display: "flex", flexDirection: "column", gap: "16px"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <Shield size={24} color="#10b981" />
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: 900, color: "#f8fafc", margin: 0 }}>
                Proposed Hummingbot Risk-Control Specification
              </h3>
              <p style={{ fontSize: "12px", color: "#94a3b8", margin: "2px 0 0 0" }}>
                Design targets only; no authenticated execution adapter is deployed
              </p>
            </div>
          </div>
          <span style={{ background: "rgba(16,185,129,0.15)", color: "#10b981", padding: "4px 12px", borderRadius: "20px", fontSize: "11px", fontWeight: 900 }}>
            NOT ACTIVE
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px" }}>
          <div style={{ background: "#1e293b", padding: "12px 14px", borderRadius: "12px" }}>
            <div style={{ fontSize: "11px", color: "#10b981", fontWeight: 800 }}>Layer 1: Atomic Hedging</div>
            <div style={{ fontSize: "12px", color: "#e2e8f0", marginTop: "4px" }}>Target: reconcile both CEX and DEX fills before reporting a hedge.</div>
          </div>
          <div style={{ background: "#1e293b", padding: "12px 14px", borderRadius: "12px" }}>
            <div style={{ fontSize: "11px", color: "#10b981", fontWeight: 800 }}>Layer 2: Min Spread (≥1.2%)</div>
            <div style={{ fontSize: "12px", color: "#e2e8f0", marginTop: "4px" }}>Target: reject opportunities whose quoted spread does not cover estimated fees.</div>
          </div>
          <div style={{ background: "#1e293b", padding: "12px 14px", borderRadius: "12px" }}>
            <div style={{ fontSize: "11px", color: "#10b981", fontWeight: 800 }}>Layer 3: Gas Shield (1.5x)</div>
            <div style={{ fontSize: "12px", color: "#e2e8f0", marginTop: "4px" }}>Target: reject execution unless estimated margin exceeds 1.5x gas.</div>
          </div>
          <div style={{ background: "#1e293b", padding: "12px 14px", borderRadius: "12px" }}>
            <div style={{ fontSize: "11px", color: "#10b981", fontWeight: 800 }}>Layer 4: 85%+ Win Baseline</div>
            <div style={{ fontSize: "12px", color: "#e2e8f0", marginTop: "4px" }}>Target: require independently verified paper results before mainnet review.</div>
          </div>
          <div style={{ background: "#1e293b", padding: "12px 14px", borderRadius: "12px" }}>
            <div style={{ fontSize: "11px", color: "#10b981", fontWeight: 800 }}>Layer 5: Verified Fill Notification</div>
            <div style={{ fontSize: "12px", color: "#e2e8f0", marginTop: "4px" }}>Target: notify only after a receipt or exchange fill is reconciled server-side.</div>
          </div>
        </div>
      </div>

      {/* 📊 REVENUE SYSTEM COMPARISON & FUNDING PLAYBOOK */}
      <div style={{
        background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "20px", padding: "22px", display: "flex", flexDirection: "column", gap: "16px"
      }}>
        <h3 style={{ fontSize: "16px", fontWeight: 900, color: "#f8fafc", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
          📊 Execution-System Readiness Comparison
        </h3>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
          
          {/* System 1: Quant Alpha & BSC Sniper */}
          <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "16px", padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "14px", fontWeight: 800, color: "#10b981" }}>System 1: Lumina Quant Alpha & DEX Sniper</span>
              <span style={{ background: "#10b981", color: "#022c22", fontSize: "10px", fontWeight: 900, padding: "2px 8px", borderRadius: "10px" }}>RECOMMENDED FIRST</span>
            </div>
            <p style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: "1.5", margin: 0 }}>
              <strong>Mechanism</strong>: Direct PancakeSwap DEX Swaps & Token Launch Sniping.<br/>
              <strong>Current readiness</strong>: Paper strategies plus one wallet-signed, receipt-verified USDT transfer path.<br/>
              <strong>Funding warning</strong>: Do not fund an address based on this screen. Verify every destination in the connected wallet.<br/>
              <strong>Next gate</strong>: Add a router-specific receipt reconciler before enabling any trading action.
            </p>
          </div>

          {/* System 2: Hummingbot CEX/DEX Arbitrage */}
          <div style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.3)", borderRadius: "16px", padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "14px", fontWeight: 800, color: "#a78bfa" }}>System 2: Hummingbot CEX ↔ DEX Gateway</span>
              <span style={{ background: "#a78bfa", color: "#1e1b4b", fontSize: "10px", fontWeight: 900, padding: "2px 8px", borderRadius: "10px" }}>PHASE 2 EXPANSION</span>
            </div>
            <p style={{ fontSize: "12px", color: "#cbd5e1", lineHeight: "1.5", margin: 0 }}>
              <strong>Mechanism</strong>: Orderbook Market Making & CEX/DEX Spread Arbitrage.<br/>
              <strong>Current readiness</strong>: Health probe only; authenticated create/start/stop and exchange-fill endpoints are not configured.<br/>
              <strong>Funding warning</strong>: Do not deposit funds for this integration yet.<br/>
              <strong>Next gate</strong>: Deploy private credentials and reconcile each exchange fill and chain leg.
            </p>
          </div>
        </div>
      </div>

      {/* Strategy Launchpad Cards */}
      <div>
        <h2 style={{ fontSize: "17px", fontWeight: 800, color: "#f8fafc", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
          ⚡ Pre-Configured Hummingbot Strategy Launchpad
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "18px" }}>
          
          {/* Card 1: CEX / DEX Arbitrage */}
          <div style={{ background: "#0f172a", border: "1px solid rgba(124,58,237,0.3)", borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "16px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <Zap size={18} color="#a78bfa" />
                <h3 style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", margin: 0 }}>CEX ↔ DEX Arbitrage</h3>
              </div>
              <p style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.4, margin: 0 }}>
                Proposed Binance/PancakeSwap spread strategy. It is not launchable until authenticated execution and dual-leg reconciliation are configured.
              </p>
            </div>

            <button
              onClick={() => handleLaunchStrategy("Binance ↔ PancakeSwap Arbitrage", "CEX_DEX_ARBITRAGE", "CAKE/WBNB", "Binance CEX", "PancakeSwap v2")}
              style={{
                padding: "10px", background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
                border: "none", borderRadius: "10px", color: "white", fontWeight: 800,
                fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
              }}
            >
              <Play size={14} /> Check Strategy Availability
            </button>
          </div>

          {/* Card 2: Pure Market Making Grid */}
          <div style={{ background: "#0f172a", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "18px", padding: "20px", display: "flex", flexDirection: "column", justifyContent: "space-between", gap: "16px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <Activity size={18} color="#10b981" />
                <h3 style={{ fontSize: "16px", fontWeight: 800, color: "#f8fafc", margin: 0 }}>Pure Market Making Grid</h3>
              </div>
              <p style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.4, margin: 0 }}>
                Proposed Avellaneda-Stoikov market-making strategy. No exchange order endpoint is currently connected.
              </p>
            </div>

            <button
              onClick={() => handleLaunchStrategy("BNB/USDT Grid Market Maker", "PURE_MARKET_MAKING", "BNB/USDT", "Binance CEX")}
              style={{
                padding: "10px", background: "linear-gradient(135deg, #10b981, #059669)",
                border: "none", borderRadius: "10px", color: "#022c22", fontWeight: 900,
                fontSize: "12px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
              }}
            >
              <Play size={14} /> Check Strategy Availability
            </button>
          </div>

        </div>
      </div>

      {/* Active Hummingbot Fleet Grid */}
      <div>
        <h2 style={{ fontSize: "17px", fontWeight: 800, color: "#f8fafc", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
          🤖 Active Hummingbot Bot Fleet ({bots.length})
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "16px" }}>
          {bots.map(bot => (
            <div key={bot.id} style={{
              background: "#0f172a", border: `1px solid ${bot.status === "RUNNING" ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.08)"}`,
              borderRadius: "16px", padding: "18px", display: "flex", flexDirection: "column", gap: "14px"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "15px", fontWeight: 800, color: "#f8fafc" }}>{bot.name}</div>
                  <div style={{ fontSize: "12px", color: "#64748b" }}>{bot.pair} · {bot.primaryExchange} {bot.secondaryExchange ? `↔ ${bot.secondaryExchange}` : ""}</div>
                </div>

                <span style={{
                  padding: "4px 10px", borderRadius: "12px", fontSize: "10px", fontWeight: 900,
                  background: bot.status === "RUNNING" ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
                  color: bot.status === "RUNNING" ? "#10b981" : "#f87171"
                }}>
                  {bot.status}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px", fontSize: "11px" }}>
                <div style={{ background: "#1e293b", padding: "8px", borderRadius: "8px" }}>
                  <div style={{ color: "#64748b", fontSize: "10px" }}>Total Volume</div>
                  <div style={{ color: "#e2e8f0", fontWeight: 800 }}>${bot.totalVolumeUsd.toFixed(2)}</div>
                </div>

                <div style={{ background: "#1e293b", padding: "8px", borderRadius: "8px" }}>
                  <div style={{ color: "#64748b", fontSize: "10px" }}>Order Fills</div>
                  <div style={{ color: "#a78bfa", fontWeight: 800 }}>{bot.orderFillsCount} fills</div>
                </div>

                <div style={{ background: "#1e293b", padding: "8px", borderRadius: "8px" }}>
                  <div style={{ color: "#64748b", fontSize: "10px" }}>Net Realized PnL</div>
                  <div style={{ color: "#10b981", fontWeight: 800 }}>+${bot.realizedPnlUsd.toFixed(2)}</div>
                </div>
              </div>

              <button
                onClick={() => handleToggleBot(bot.id)}
                style={{
                  padding: "8px", background: bot.status === "RUNNING" ? "rgba(239,68,68,0.15)" : "rgba(16,185,129,0.15)",
                  border: `1px solid ${bot.status === "RUNNING" ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`,
                  borderRadius: "10px", color: bot.status === "RUNNING" ? "#f87171" : "#34d399",
                  fontWeight: 800, fontSize: "12px", cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "6px"
                }}
              >
                {bot.status === "RUNNING" ? <Square size={14} /> : <Play size={14} />}
                {bot.status === "RUNNING" ? "Stop Strategy" : "Start Strategy"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Local Docker CLI Deployment Instructions Card */}
      <div style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "18px", padding: "20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          <Terminal size={18} color="#a78bfa" />
          <h3 style={{ fontSize: "15px", fontWeight: 800, color: "#f8fafc", margin: 0 }}>
            How to Run Local Hummingbot Docker Instance
          </h3>
        </div>
        <p style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.4, margin: "0 0 12px 0" }}>
          Run the official Hummingbot Docker container locally or on your private VPS to connect with Lumina's REST Gateway API:
        </p>
        <pre style={{ background: "#1e293b", padding: "12px", borderRadius: "10px", color: "#34d399", fontSize: "12px", fontFamily: "monospace", overflowX: "auto" }}>
          {`docker run -it --name hummingbot-instance -p 15888:15888 hummingbot/hummingbot:latest`}
        </pre>
      </div>

    </div>
  );
}
