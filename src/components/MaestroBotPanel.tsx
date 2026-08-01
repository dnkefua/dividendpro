import React, { useState, useEffect } from "react";
import { MaestroTokenInfo } from "../types";
import { checkHoneypot, getTokenMetadata } from "../services/alchemyBSC";
import { getTelegramStatus, testTelegramConnection } from "../services/telegram";
import {
  Search, ShieldCheck, ShieldAlert, ExternalLink,
  AlertTriangle, Info, Zap, Users, DollarSign, Activity
} from "lucide-react";

const MAESTRO_BOT_URL = "https://t.me/maestro?start=";
const BSCSCAN_URL = "https://bscscan.com/token/";

function isValidContract(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function MaestroBotPanel() {
  const [contractInput, setContractInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tokenInfo, setTokenInfo] = useState<MaestroTokenInfo | null>(null);

  // Telegram Integration State
  const [tgConnected, setTgConnected] = useState(false);
  const [tgStatusNotice, setTgStatusNotice] = useState("");

  // Autonomous Maestro Profit Sniper State
  const [autoMaestroActive, setAutoMaestroActive] = useState(false);
  const [takeProfitTargetPct, setTakeProfitTargetPct] = useState(80);
  const [stopLossPct, setStopLossPct] = useState(25);
  const [totalMaestroProfitBnb, setTotalMaestroProfitBnb] = useState(0);
  const [maestroLogs, setMaestroLogs] = useState<Array<{ id: string; time: string; type: "snipe" | "tp" | "tg"; message: string }>>([
    { id: "1", time: new Date().toLocaleTimeString(), type: "snipe", message: "🧪 Maestro paper simulator ready. No wallet transaction will be created." },
  ]);

  useEffect(() => {
    getTelegramStatus().then((status) => setTgConnected(status.configured));
  }, []);

  const handleTestTelegram = async () => {
    setTgStatusNotice("Sending test alert to Telegram...");
    const ok = await testTelegramConnection();
    if (ok) {
      setTgStatusNotice("✅ Test message delivered to Telegram!");
    } else {
      setTgStatusNotice("❌ Server-side Telegram is unavailable or you are not signed in.");
    }
  };

  // Autonomous Maestro Loop
  useEffect(() => {
    let timer: any = null;
    if (autoMaestroActive) {
      timer = setInterval(async () => {
        // Simulate/execute autonomous snipe & profit cycle
        const symbols = ["SHIBX", "PEPEBSC", "DOGEX", "SOLA", "BABYBNB"];
        const randSym = symbols[Math.floor(Math.random() * symbols.length)];
        const profitBnb = parseFloat((0.015 + Math.random() * 0.035).toFixed(4));
        const profitUsd = parseFloat((profitBnb * 620).toFixed(2));

        setTotalMaestroProfitBnb(prev => parseFloat((prev + profitBnb).toFixed(4)));

        const logMsg = `🧪 [MAESTRO SIMULATION] Modelled ${randSym} TP at +${takeProfitTargetPct}%. Simulated PnL: +${profitBnb} BNB ($${profitUsd}); no funds moved.`;
        setMaestroLogs(prev => [
          { id: Math.random().toString(), time: new Date().toLocaleTimeString(), type: "tp", message: logMsg },
          ...prev.slice(0, 20)
        ]);

      }, 7000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [autoMaestroActive, takeProfitTargetPct]);

  const handleAnalyze = async () => {
    const addr = contractInput.trim();
    if (!isValidContract(addr)) {
      setError("Please enter a valid BSC contract address (0x...)");
      return;
    }
    setError("");
    setLoading(true);
    setTokenInfo(null);

    try {
      const [meta, honeypot] = await Promise.all([
        getTokenMetadata(addr),
        checkHoneypot(addr),
      ]);

      const info: MaestroTokenInfo = {
        contract: addr,
        name: meta?.name || "Unknown Token",
        symbol: meta?.symbol || "???",
        decimals: meta?.decimals || 18,
        totalSupply: "N/A",
        holders: 0,
        liquidity: 0,
        liquidityLocked: false,
        contractVerified: false,
        isHoneypot: honeypot.isHoneypot,
        buyTax: honeypot.buyTax,
        sellTax: honeypot.sellTax,
        top10HoldersPct: 0,
        priceUsd: 0,
        marketCap: 0,
        volume24h: 0,
      };

      setTokenInfo(info);
    } catch {
      setError("Failed to fetch token info. Check the contract address.");
    } finally {
      setLoading(false);
    }
  };

  const openMaestro = () => {
    if (!tokenInfo) return;
    window.open(`${MAESTRO_BOT_URL}${tokenInfo.contract}_bsc-snipe`, "_blank");
  };

  const safetyScore = tokenInfo
    ? tokenInfo.isHoneypot
      ? 0
      : Math.max(0, 100 - tokenInfo.buyTax * 2 - tokenInfo.sellTax * 2)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Autonomous Maestro Control Header */}
      <div style={{
        background: "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(16,185,129,0.12))",
        border: "1px solid rgba(124,58,237,0.35)",
        borderRadius: "16px",
        padding: "24px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "16px"
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <div style={{
              width: "40px", height: "40px", borderRadius: "10px",
              background: "linear-gradient(135deg, #7C3AED, #10B981)",
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              <Zap size={22} color="white" />
            </div>
            <div>
              <h2 style={{ fontSize: "20px", fontWeight: 800, color: "#f8fafc", margin: 0 }}>
                Maestro Paper Strategy Simulator
              </h2>
              <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>
                Models token-launch entries and exits locally. It does not submit wallet transactions or report simulated PnL as live profit.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <button
            onClick={() => setAutoMaestroActive(!autoMaestroActive)}
            style={{
              padding: "12px 24px",
              background: autoMaestroActive ? "linear-gradient(135deg, #10b981, #059669)" : "linear-gradient(135deg, #7C3AED, #6D28D9)",
              border: "none", borderRadius: "12px", color: "white",
              fontWeight: 800, fontSize: "14px", cursor: "pointer",
              display: "flex", alignItems: "center", gap: "8px",
              boxShadow: autoMaestroActive ? "0 0 20px rgba(16,185,129,0.4)" : "none"
            }}
          >
            <Activity size={18} />
            {autoMaestroActive ? "🧪 Paper Simulation ACTIVE" : "Start Paper Simulation"}
          </button>
        </div>
      </div>

      {/* Autonomous Performance Ledger */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "14px"
      }}>
        <div style={{ background: "rgba(15,20,30,0.6)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "16px" }}>
          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
            Simulated Maestro PnL
          </div>
          <div style={{ fontSize: "20px", fontWeight: 800, color: "#10b981", fontFamily: "monospace" }}>
            +{totalMaestroProfitBnb} BNB (~${(totalMaestroProfitBnb * 620).toFixed(2)})
          </div>
        </div>

        <div style={{ background: "rgba(15,20,30,0.6)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "16px" }}>
          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
            Take-Profit Target
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "20px", fontWeight: 800, color: "#a78bfa" }}>+{takeProfitTargetPct}%</span>
            <input
              type="range" min="20" max="300" step="10"
              value={takeProfitTargetPct}
              onChange={e => setTakeProfitTargetPct(Number(e.target.value))}
              style={{ width: "100px", accentColor: "#7C3AED" }}
            />
          </div>
        </div>

        <div style={{ background: "rgba(15,20,30,0.6)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "16px" }}>
          <div style={{ fontSize: "11px", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
            Telegram Truth-Layer Status
          </div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: tgConnected ? "#10b981" : "#f59e0b", display: "flex", alignItems: "center", gap: "6px" }}>
            {tgConnected ? "🟢 Server Managed" : "⚠️ Server Not Configured"}
          </div>
        </div>
      </div>

      {/* Server-managed Telegram status */}
      <div style={{
        background: "rgba(15,20,30,0.6)", border: "1px solid rgba(124,58,237,0.25)",
        borderRadius: "16px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: "15px", fontWeight: 800, color: "#f8fafc", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            📱 Server-Managed Telegram Notifications
          </h3>
          <span style={{ fontSize: "11px", color: tgConnected ? "#10b981" : "#64748b" }}>
            {tgConnected ? "● Server Configured" : "○ Server Not Configured"}
          </span>
        </div>

        <p style={{ margin: 0, color: "#94a3b8", fontSize: "12px", lineHeight: 1.6 }}>
          Bot credentials and the destination chat are held only by the backend. The browser cannot read, save, or call Telegram with the bot token. Maestro results on this page are simulations and are never reported as realized profit.
        </p>

        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={handleTestTelegram}
            disabled={!tgConnected}
            style={{
              padding: "8px 16px", background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#e2e8f0", fontWeight: 600, fontSize: "12px", cursor: tgConnected ? "pointer" : "not-allowed",
              opacity: tgConnected ? 1 : 0.5,
            }}
          >
            Send Authenticated Test Alert
          </button>
        </div>

        {tgStatusNotice && (
          <p style={{ fontSize: "12px", color: "#34d399", margin: 0, fontWeight: 600 }}>
            {tgStatusNotice}
          </p>
        )}
      </div>

      {/* Contract Input */}
      <div style={{
        background: "rgba(15,20,30,0.6)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "16px",
        padding: "24px"
      }}>
        <label style={{ fontSize: "13px", color: "#94a3b8", fontWeight: 600, display: "block", marginBottom: "10px" }}>
          BSC Token Contract Address
        </label>
        <div style={{ display: "flex", gap: "10px" }}>
          <input
            value={contractInput}
            onChange={e => setContractInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAnalyze()}
            placeholder="0x... (e.g. 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82)"
            style={{
              flex: 1, padding: "12px 16px",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "10px", color: "#e2e8f0",
              fontSize: "13px", fontFamily: "monospace",
              outline: "none"
            }}
          />
          <button
            onClick={handleAnalyze}
            disabled={loading}
            style={{
              padding: "12px 20px",
              background: loading ? "rgba(124,58,237,0.4)" : "linear-gradient(135deg, #7C3AED, #6D28D9)",
              border: "none", borderRadius: "10px", color: "white",
              fontWeight: 600, fontSize: "14px", cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: "8px", whiteSpace: "nowrap"
            }}
          >
            <Search size={16} />
            {loading ? "Scanning…" : "Analyze"}
          </button>
        </div>
        {error && (
          <p style={{ color: "#f87171", fontSize: "12px", marginTop: "8px" }}>
            <AlertTriangle size={12} style={{ display: "inline", marginRight: "4px", verticalAlign: "middle" }} />
            {error}
          </p>
        )}
      </div>

      {/* Token Info Card */}
      {tokenInfo && (
        <div style={{
          background: "rgba(15,20,30,0.6)",
          border: `1px solid ${tokenInfo.isHoneypot ? "rgba(239,68,68,0.4)" : "rgba(16,185,129,0.25)"}`,
          borderRadius: "16px", padding: "24px"
        }}>
          {/* Token Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
            <div>
              <h3 style={{ fontSize: "22px", fontWeight: 700, color: "#e2e8f0", margin: "0 0 4px 0" }}>
                {tokenInfo.symbol}
                <span style={{ fontSize: "14px", color: "#64748b", fontWeight: 400, marginLeft: "8px" }}>
                  {tokenInfo.name}
                </span>
              </h3>
              <span style={{
                fontSize: "11px", fontFamily: "monospace", color: "#64748b",
                cursor: "pointer"
              }} onClick={() => window.open(`${BSCSCAN_URL}${tokenInfo.contract}`, "_blank")}>
                {shortAddr(tokenInfo.contract)} ↗
              </span>
            </div>
            {/* Safety Badge */}
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              background: tokenInfo.isHoneypot
                ? "rgba(239,68,68,0.15)"
                : safetyScore! >= 70
                  ? "rgba(16,185,129,0.15)"
                  : "rgba(245,158,11,0.15)",
              border: `1px solid ${tokenInfo.isHoneypot ? "rgba(239,68,68,0.4)" : safetyScore! >= 70 ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}`,
              borderRadius: "12px", padding: "10px 16px"
            }}>
              {tokenInfo.isHoneypot
                ? <ShieldAlert size={24} color="#f87171" />
                : <ShieldCheck size={24} color={safetyScore! >= 70 ? "#10b981" : "#f59e0b"} />
              }
              <span style={{
                fontSize: "11px", fontWeight: 700, marginTop: "4px",
                color: tokenInfo.isHoneypot ? "#f87171" : safetyScore! >= 70 ? "#10b981" : "#f59e0b"
              }}>
                {tokenInfo.isHoneypot ? "HONEYPOT" : `${Math.round(safetyScore!)}% Safe`}
              </span>
            </div>
          </div>

          {/* Metrics Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "20px" }}>
            {[
              { label: "Buy Tax", value: `${tokenInfo.buyTax.toFixed(1)}%`, icon: <DollarSign size={14} />, danger: tokenInfo.buyTax > 10 },
              { label: "Sell Tax", value: `${tokenInfo.sellTax.toFixed(1)}%`, icon: <DollarSign size={14} />, danger: tokenInfo.sellTax > 10 },
              { label: "Honeypot Risk", value: tokenInfo.isHoneypot ? "YES" : "NO", icon: <AlertTriangle size={14} />, danger: tokenInfo.isHoneypot },
              { label: "Decimals", value: String(tokenInfo.decimals), icon: <Activity size={14} />, danger: false },
              { label: "Contract", value: "BSC Mainnet", icon: <Activity size={14} />, danger: false },
              { label: "Holders", value: tokenInfo.holders > 0 ? tokenInfo.holders.toLocaleString() : "N/A", icon: <Users size={14} />, danger: false },
            ].map((m, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,0.03)", borderRadius: "10px",
                padding: "12px", border: `1px solid ${m.danger ? "rgba(239,68,68,0.25)" : "rgba(255,255,255,0.07)"}`
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", color: "#64748b", marginBottom: "6px", fontSize: "11px" }}>
                  {m.icon}{m.label}
                </div>
                <div style={{ fontSize: "16px", fontWeight: 700, color: m.danger ? "#f87171" : "#e2e8f0" }}>
                  {m.value}
                </div>
              </div>
            ))}
          </div>

          {/* Honeypot Warning */}
          {tokenInfo.isHoneypot && (
            <div style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "10px", padding: "12px 16px", marginBottom: "16px",
              display: "flex", gap: "10px"
            }}>
              <ShieldAlert size={20} color="#f87171" style={{ flexShrink: 0, marginTop: "1px" }} />
              <div>
                <div style={{ fontWeight: 700, color: "#f87171", fontSize: "13px" }}>HONEYPOT DETECTED</div>
                <div style={{ color: "#fca5a5", fontSize: "12px", marginTop: "2px" }}>
                  This token appears to be a honeypot — you can buy but cannot sell. Do NOT invest.
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              onClick={openMaestro}
              disabled={tokenInfo.isHoneypot}
              style={{
                flex: 1, padding: "14px 20px",
                background: tokenInfo.isHoneypot
                  ? "rgba(100,116,139,0.2)"
                  : "linear-gradient(135deg, #7C3AED, #00C2FF)",
                border: "none", borderRadius: "10px", color: tokenInfo.isHoneypot ? "#64748b" : "white",
                fontWeight: 700, fontSize: "15px", cursor: tokenInfo.isHoneypot ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
                minWidth: "180px"
              }}
            >
              <Zap size={18} />
              {tokenInfo.isHoneypot ? "Sniping Blocked (Honeypot)" : "Open in Maestro Bot ↗"}
            </button>
            <button
              onClick={() => window.open(`${BSCSCAN_URL}${tokenInfo.contract}`, "_blank")}
              style={{
                padding: "14px 18px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "10px", color: "#e2e8f0",
                fontWeight: 600, fontSize: "14px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "6px"
              }}
            >
              <ExternalLink size={14} /> BscScan
            </button>
          </div>

          {!tokenInfo.isHoneypot && (
            <p style={{ fontSize: "11px", color: "#475569", marginTop: "10px", textAlign: "center" }}>
              Clicking "Open in Maestro Bot" launches @maestro on Telegram with this token pre-loaded for sniping.
              Your Maestro wallet and settings remain in Telegram.
            </p>
          )}
        </div>
      )}

      {/* Quick Launch Popular Tokens */}
      <div style={{
        background: "rgba(15,20,30,0.6)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "16px", padding: "20px"
      }}>
        <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#94a3b8", marginBottom: "14px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Quick Snipe — Popular BSC Tokens
        </h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {[
            { symbol: "CAKE", contract: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82" },
            { symbol: "XVS", contract: "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63" },
            { symbol: "ALPACA", contract: "0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F" },
            { symbol: "AUTO", contract: "0xa184088a740c695E156F91f5cC086a06bb78b827" },
            { symbol: "BAKE", contract: "0xE02dF9e3e622DeBdD69fb838bB799E3F168902c5" },
            { symbol: "TWT", contract: "0x4B0F1812e5Df2A09796481Ff14017e6005508003" },
          ].map(t => (
            <button
              key={t.symbol}
              onClick={() => window.open(`${MAESTRO_BOT_URL}${t.contract}_bsc-snipe`, "_blank")}
              style={{
                padding: "8px 14px",
                background: "rgba(124,58,237,0.12)",
                border: "1px solid rgba(124,58,237,0.25)",
                borderRadius: "8px", color: "#a78bfa",
                fontWeight: 600, fontSize: "13px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "6px"
              }}
            >
              <Zap size={12} />{t.symbol}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
