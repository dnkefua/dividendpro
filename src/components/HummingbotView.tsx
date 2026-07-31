import React, { useState, useEffect } from "react";
import {
  checkHummingbotGatewayHealth,
  getMockHummingbotBots,
  HummingbotGatewayStatus,
  HummingbotBotStatus
} from "../services/hummingbotService";
import {
  Bot, Cpu, Activity, RefreshCw, Zap, Shield, Play, Square,
  CheckCircle2, AlertTriangle, Layers, ArrowUpRight, Server, Terminal
} from "lucide-react";

export default function HummingbotView() {
  const [gatewayUrl, setGatewayUrl] = useState("http://localhost:15888");
  const [gatewayStatus, setGatewayStatus] = useState<HummingbotGatewayStatus | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [bots, setBots] = useState<HummingbotBotStatus[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    handleCheckHealth();
    setBots(getMockHummingbotBots());
  }, []);

  const handleCheckHealth = async () => {
    setLoadingHealth(true);
    const status = await checkHummingbotGatewayHealth(gatewayUrl);
    setGatewayStatus(status);
    setLoadingHealth(false);
  };

  const handleToggleBot = (botId: string) => {
    setBots(prev => prev.map(bot => {
      if (bot.id === botId) {
        const newStatus = bot.status === "RUNNING" ? "STOPPED" : "RUNNING";
        setNotice(`Hummingbot bot "${bot.name}" is now ${newStatus}.`);
        return { ...bot, status: newStatus };
      }
      return bot;
    }));
  };

  const handleLaunchStrategy = (name: string, strategyType: "CEX_DEX_ARBITRAGE" | "PURE_MARKET_MAKING" | "LIQUIDITY_MINING", pair: string, primaryExchange: string, secondaryExchange?: string) => {
    const newBot: HummingbotBotStatus = {
      id: `hb-bot-${Date.now()}`,
      name,
      strategyType,
      pair,
      primaryExchange,
      secondaryExchange,
      status: "RUNNING",
      uptimeSeconds: 10,
      totalVolumeUsd: 250.00,
      realizedPnlUsd: 4.50,
      realizedPnlBnb: 0.0072,
      orderFillsCount: 2,
      createdAt: new Date().toLocaleTimeString()
    };

    setBots(prev => [newBot, ...prev]);
    setNotice(`Successfully launched new Hummingbot strategy "${name}"!`);
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
              Hummingbot REST Gateway Controller
            </h1>
            <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
              Algorithmic CEX ↔ DEX Arbitrage, Pure Market Making Grid & Liquidity Mining Engine
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
            {gatewayStatus?.connected ? `🟢 CONNECTED (${gatewayStatus.latencyMs}ms)` : `⚡ GATEWAY READY (Simulated REST Endpoint)`}
          </span>
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
                Scans orderbook prices on Binance CEX against AMM liquidity pools on PancakeSwap v2, executing instant riskless spread arbitrage.
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
              <Play size={14} /> Launch CEX ↔ DEX Arbitrage Bot
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
                Automatically posts continuous bid/ask limit orders around target mid-price using Avellaneda-Stoikov inventory control model.
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
              <Play size={14} /> Launch Market Making Grid Bot
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
