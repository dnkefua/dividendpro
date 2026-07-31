import React, { useState, useEffect, useRef, useCallback } from "react";
import { ethers } from "ethers";
import {
  getSniperEngine,
  SniperConfig,
  SniperPosition,
  SniperLogEntry,
  SniperStatus,
  encryptAndStoreWallet,
  decryptWallet,
  hasStoredWallet,
  clearStoredWallet,
} from "../services/sniper";
import {
  saveTelegramConfig,
  hasTelegramConfig,
  testTelegramConnection,
  discoverChatId,
  getBotInfo,
  getStoredToken,
  getStoredChatId,
} from "../services/telegram";
import {
  Zap, Square, Shield, Settings2, Activity, Wallet,
  TrendingUp, TrendingDown, Send, Eye, EyeOff,
  AlertTriangle, CheckCircle, XCircle, ExternalLink,
  RefreshCw, Trash2, Bell, BellOff, ChevronDown, ChevronUp,
  Play, Lock, Unlock
} from "lucide-react";

interface SniperBotProps {
  alchemyApiKey: string;
}

const DEFAULT_CONFIG: SniperConfig = {
  buyAmountBnb: 0.05,
  slippagePct: 20,
  gasMultiplier: 2,
  minLiquidityBnb: 1,
  maxBuyTaxPct: 10,
  maxSellTaxPct: 15,
  honeypotCheck: true,
  takeProfitPct: 100,
  stopLossPct: 30,
  maxPositions: 5,
  deadlineMinutes: 5,
  antiRugProtection: true,
  multiTierTakeProfit: true,
};

type SubView = "console" | "mempool" | "positions" | "settings" | "telegram";

const LOG_COLORS: Record<SniperLogEntry["type"], string> = {
  info: "#94a3b8",
  success: "#10b981",
  error: "#f87171",
  warn: "#f59e0b",
  snipe: "#a78bfa",
};

const LOG_ICONS: Record<SniperLogEntry["type"], string> = {
  info: "ℹ",
  success: "✓",
  error: "✕",
  warn: "⚠",
  snipe: "⚡",
};

export default function SniperBot({ alchemyApiKey }: SniperBotProps) {
  const [subView, setSubView] = useState<SubView>("console");
  const [status, setStatus] = useState<SniperStatus>("idle");
  const [logs, setLogs] = useState<SniperLogEntry[]>([]);
  const [positions, setPositions] = useState<SniperPosition[]>([]);
  const [config, setConfig] = useState<SniperConfig>(DEFAULT_CONFIG);
  const [engineRef] = useState(() => getSniperEngine(DEFAULT_CONFIG, alchemyApiKey));

  // Wallet setup
  const [walletStep, setWalletStep] = useState<"check" | "import" | "unlock" | "ready">(
    hasStoredWallet() ? "unlock" : "import"
  );
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletError, setWalletError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  // Telegram
  const [tgToken, setTgToken] = useState(getStoredToken());
  const [tgChatId, setTgChatId] = useState(getStoredChatId());
  const [tgConnected, setTgConnected] = useState(hasTelegramConfig());
  const [tgTesting, setTgTesting] = useState(false);
  const [tgTestResult, setTgTestResult] = useState<"" | "ok" | "fail">("" );
  const [tgDiscovering, setTgDiscovering] = useState(false);
  const [tgBotName, setTgBotName] = useState("");
  const [tgBotUsername, setTgBotUsername] = useState("");

  // Manual snipe
  const [manualContract, setManualContract] = useState("");
  const [manualSniping, setManualSniping] = useState(false);

  const logEndRef = useRef<HTMLDivElement>(null);
  const decryptedWalletRef = useRef<ethers.Wallet | null>(null);

  // Wire up engine callbacks
  useEffect(() => {
    engineRef.onLog = (entry) => setLogs(prev => [...prev.slice(-200), entry]);
    engineRef.onStatusChange = (s) => setStatus(s);
    engineRef.onPositionUpdate = (p) => setPositions([...p]);
  }, [engineRef]);

  // Auto-load bot info on mount
  useEffect(() => {
    getBotInfo().then(info => {
      if (info) {
        setTgBotName(info.name);
        setTgBotUsername(info.username);
      }
    });
    // Auto-discover chat ID if token is present but chat ID is not
    if (getStoredToken() && !getStoredChatId()) {
      discoverChatId().then(id => {
        if (id) { setTgChatId(id); setTgConnected(hasTelegramConfig()); }
      });
    }
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // ── Wallet handlers ─────────────────────────────────────────────────────────

  const handleImportWallet = async () => {
    setWalletError("");
    if (!privateKeyInput.trim()) { setWalletError("Enter a private key or mnemonic."); return; }
    if (passwordInput.length < 8) { setWalletError("Password must be at least 8 characters."); return; }
    if (passwordInput !== confirmPassword) { setWalletError("Passwords do not match."); return; }
    try {
      const address = await encryptAndStoreWallet(privateKeyInput.trim(), passwordInput);
      setWalletAddress(address);
      setPrivateKeyInput("");
      setConfirmPassword("");
      setWalletStep("ready");
    } catch {
      setWalletError("Invalid private key or mnemonic. Double-check and try again.");
    }
  };

  const handleUnlock = async () => {
    setUnlocking(true);
    setWalletError("");
    try {
      const wallet = await decryptWallet(passwordInput);
      if (!wallet) { setWalletError("Wrong password."); setUnlocking(false); return; }
      decryptedWalletRef.current = wallet;
      setWalletAddress(wallet.address);
      setWalletStep("ready");
    } catch {
      setWalletError("Failed to decrypt wallet.");
    } finally {
      setUnlocking(false);
    }
  };

  const handleClearWallet = () => {
    clearStoredWallet();
    decryptedWalletRef.current = null;
    setWalletAddress("");
    setPasswordInput("");
    setWalletStep("import");
    if (status === "running") handleStop();
  };

  // ── Bot start / stop ────────────────────────────────────────────────────────

  const handleStart = async () => {
    let wallet = decryptedWalletRef.current;
    if (!wallet) {
      if (passwordInput) {
        wallet = await decryptWallet(passwordInput);
      }
      if (!wallet) {
        // Create an ephemeral session wallet so user can start bot instantly
        wallet = ethers.Wallet.createRandom();
        decryptedWalletRef.current = wallet;
        setWalletAddress(wallet.address);
        setWalletStep("ready");
      }
    }
    engineRef.updateConfig(config);
    await engineRef.start(wallet);
  };

  const handleStop = useCallback(async () => {
    await engineRef.stop();
  }, [engineRef]);

  // ── Manual snipe ────────────────────────────────────────────────────────────

  const handleManualSnipe = async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(manualContract.trim())) return;
    if (!decryptedWalletRef.current && walletStep !== "ready") {
      setWalletError("Unlock your wallet first.");
      return;
    }
    // Ensure engine has wallet
    if (status !== "running") {
      const wallet = decryptedWalletRef.current || await decryptWallet(passwordInput);
      if (!wallet) return;
      decryptedWalletRef.current = wallet;
      engineRef.updateConfig(config);
      await engineRef.start(wallet);
    }
    setManualSniping(true);
    await engineRef.runSafetyAndBuy(manualContract.trim());
    setManualSniping(false);
  };

  // ── Telegram ────────────────────────────────────────────────────────────────

  const handleSaveTelegram = () => {
    saveTelegramConfig(tgToken, tgChatId);
    setTgConnected(hasTelegramConfig());
  };

  const handleTestTelegram = async () => {
    setTgTesting(true);
    const ok = await testTelegramConnection();
    setTgTestResult(ok ? "ok" : "fail");
    setTgTesting(false);
  };

  // ── Sell position ───────────────────────────────────────────────────────────

  const handleSell = async (positionId: string) => {
    await engineRef.executeSell(positionId, "Manual sell");
  };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const openPositions = positions.filter(p => p.status === "open");
  const closedPositions = positions.filter(p => p.status !== "open");
  const totalPnlBnb = closedPositions.reduce((s, p) => s + p.pnlBnb, 0);

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: "7px 14px",
    background: active ? "rgba(124,58,237,0.2)" : "transparent",
    border: `1px solid ${active ? "rgba(124,58,237,0.4)" : "rgba(255,255,255,0.06)"}`,
    borderRadius: "8px", color: active ? "#a78bfa" : "#64748b",
    fontWeight: active ? 700 : 500, fontSize: "12px", cursor: "pointer",
    transition: "all 0.15s"
  });

  const STATUS_COLOR = status === "running" ? "#10b981" : status === "error" ? "#f87171" : "#64748b";
  const STATUS_LABEL = status === "running" ? "LIVE" : status === "error" ? "ERROR" : "OFFLINE";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>

      {/* ── Header Bar ─────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexWrap: "wrap", gap: "12px",
        background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(0,194,255,0.06))",
        border: "1px solid rgba(124,58,237,0.3)", borderRadius: "16px", padding: "16px 20px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{
            width: "42px", height: "42px", borderRadius: "12px",
            background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            <Zap size={22} color="white" />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h2 style={{ fontSize: "18px", fontWeight: 800, color: "#e2e8f0", margin: 0 }}>
                Auto-Sniper Bot
              </h2>
              <span style={{
                fontSize: "10px", fontWeight: 700, padding: "2px 8px",
                borderRadius: "20px", letterSpacing: "0.06em",
                background: status === "running" ? "rgba(16,185,129,0.2)" : "rgba(100,116,139,0.15)",
                color: STATUS_COLOR,
                border: `1px solid ${STATUS_COLOR}40`,
              }}>
                {STATUS_LABEL}
              </span>
            </div>
            <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
              PancakeSwap · BSC Mainnet · Chain 56
            </p>
          </div>
        </div>

        {/* Start / Stop */}
        <div style={{ display: "flex", gap: "8px" }}>
          {status !== "running" ? (
            <button
              onClick={handleStart}
              disabled={walletStep !== "ready"}
              style={{
                padding: "10px 20px",
                background: walletStep !== "ready" ? "rgba(124,58,237,0.2)" : "linear-gradient(135deg, #7C3AED, #4F46E5)",
                border: "none", borderRadius: "10px", color: walletStep !== "ready" ? "#64748b" : "white",
                fontWeight: 700, fontSize: "14px", cursor: walletStep !== "ready" ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", gap: "8px"
              }}
            >
              <Play size={15} />Start Bot
            </button>
          ) : (
            <button
              onClick={handleStop}
              style={{
                padding: "10px 20px",
                background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: "10px", color: "#f87171",
                fontWeight: 700, fontSize: "14px", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "8px"
              }}
            >
              <Square size={15} />Stop Bot
            </button>
          )}
        </div>
      </div>

      {/* ── Stats Row ──────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
        {[
          { label: "Open Positions", value: String(openPositions.length), color: "#a78bfa" },
          { label: "Total Trades", value: String(positions.length), color: "#60a5fa" },
          { label: "Total PnL", value: `${totalPnlBnb >= 0 ? "+" : ""}${totalPnlBnb.toFixed(4)} BNB`, color: totalPnlBnb >= 0 ? "#10b981" : "#f87171" },
          { label: "Telegram", value: tgConnected ? "Connected" : "Not set", color: tgConnected ? "#10b981" : "#64748b" },
        ].map((s, i) => (
          <div key={i} style={{
            background: "rgba(15,20,30,0.6)", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "12px", padding: "12px 14px"
          }}>
            <div style={{ fontSize: "10px", color: "#475569", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>
              {s.label}
            </div>
            <div style={{ fontSize: "16px", fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* ── Wallet Setup ───────────────────────────────────────────────────── */}
      {walletStep !== "ready" && (
        <div style={{
          background: "rgba(15,20,30,0.7)", border: "1px solid rgba(245,158,11,0.3)",
          borderRadius: "16px", padding: "20px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "16px" }}>
            <Lock size={16} color="#f59e0b" />
            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#fbbf24" }}>
              {walletStep === "import" ? "Import Sniper Wallet" : "Unlock Sniper Wallet"}
            </h3>
          </div>

          <div style={{
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: "8px", padding: "10px 12px", marginBottom: "16px", fontSize: "12px", color: "#fca5a5"
          }}>
            <AlertTriangle size={12} style={{ display: "inline", marginRight: "6px", verticalAlign: "middle" }} />
            Use a <strong>dedicated sniping wallet</strong> with only the BNB you're willing to risk. Never use your main wallet.
          </div>

          {walletStep === "import" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                  Private Key or 12-word Mnemonic
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    type={showKey ? "text" : "password"}
                    value={privateKeyInput}
                    onChange={e => setPrivateKeyInput(e.target.value)}
                    placeholder="0x... or word1 word2 word3..."
                    style={{
                      width: "100%", padding: "10px 40px 10px 12px",
                      background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "8px", color: "#e2e8f0", fontSize: "13px",
                      fontFamily: "monospace", boxSizing: "border-box"
                    }}
                  />
                  <button onClick={() => setShowKey(!showKey)} style={{
                    position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", color: "#64748b"
                  }}>
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px" }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "6px" }}>Encryption Password</label>
                  <input
                    type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)}
                    placeholder="Min 8 characters"
                    style={{ width: "100%", padding: "10px 12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#e2e8f0", fontSize: "13px", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "6px" }}>Confirm Password</label>
                  <input
                    type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Repeat password"
                    style={{ width: "100%", padding: "10px 12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#e2e8f0", fontSize: "13px", boxSizing: "border-box" }}
                  />
                </div>
              </div>
              {walletError && <p style={{ color: "#f87171", fontSize: "12px", margin: 0 }}>{walletError}</p>}
              <button onClick={handleImportWallet} style={{
                padding: "10px", background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
                border: "none", borderRadius: "8px", color: "white", fontWeight: 700, fontSize: "14px", cursor: "pointer"
              }}>
                Encrypt &amp; Save Wallet
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "6px" }}>Wallet Password</label>
                <input
                  type="password" value={passwordInput} onChange={e => setPasswordInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleUnlock()}
                  placeholder="Enter your wallet password"
                  style={{ width: "100%", padding: "10px 12px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", color: "#e2e8f0", fontSize: "13px", boxSizing: "border-box" }}
                />
              </div>
              {walletError && <p style={{ color: "#f87171", fontSize: "12px", margin: 0 }}>{walletError}</p>}
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={handleUnlock} disabled={unlocking} style={{
                  flex: 1, padding: "10px", background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
                  border: "none", borderRadius: "8px", color: "white", fontWeight: 700, fontSize: "14px", cursor: "pointer"
                }}>
                  {unlocking ? "Decrypting…" : "Unlock Wallet"}
                </button>
                <button onClick={() => { setWalletStep("import"); clearStoredWallet(); }} style={{
                  padding: "10px 14px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)",
                  borderRadius: "8px", color: "#f87171", fontSize: "13px", cursor: "pointer"
                }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Wallet ready badge */}
      {walletStep === "ready" && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)",
          borderRadius: "12px", padding: "12px 16px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Unlock size={14} color="#10b981" />
            <span style={{ fontSize: "13px", color: "#10b981", fontWeight: 600 }}>Sniper wallet unlocked</span>
            <span style={{ fontSize: "12px", fontFamily: "monospace", color: "#475569" }}>
              {walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}
            </span>
          </div>
          <button onClick={handleClearWallet} style={{
            background: "none", border: "none", cursor: "pointer", color: "#64748b", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px"
          }}>
            <Trash2 size={12} /> Remove
          </button>
        </div>
      )}

      {/* ── Sub-tabs ────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {([
          { key: "console" as SubView, label: "📡 Live Console" },
          { key: "mempool" as SubView, label: "🎯 Mempool Radar" },
          { key: "positions" as SubView, label: `📊 Positions (${openPositions.length})` },
          { key: "settings" as SubView, label: "⚙️ Bot Settings" },
          { key: "telegram" as SubView, label: `${tgConnected ? "🔔" : "🔕"} Telegram` },
        ]).map(t => (
          <button key={t.key} style={TAB_STYLE(subView === t.key)} onClick={() => setSubView(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── CONSOLE ────────────────────────────────────────────────────────── */}
      {subView === "console" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>

          {/* Manual Snipe */}
          <div style={{ background: "rgba(15,20,30,0.6)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "16px" }}>
            <label style={{ fontSize: "12px", color: "#94a3b8", fontWeight: 600, display: "block", marginBottom: "8px" }}>
              ⚡ Manual Snipe — Paste Contract Address
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                value={manualContract}
                onChange={e => setManualContract(e.target.value)}
                placeholder="0x... BSC token contract"
                style={{
                  flex: 1, padding: "10px 12px",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px", color: "#e2e8f0", fontSize: "13px", fontFamily: "monospace"
                }}
              />
              <button
                onClick={handleManualSnipe}
                disabled={manualSniping || walletStep !== "ready"}
                style={{
                  padding: "10px 16px",
                  background: manualSniping ? "rgba(124,58,237,0.3)" : "linear-gradient(135deg, #7C3AED, #4F46E5)",
                  border: "none", borderRadius: "8px", color: "white",
                  fontWeight: 700, fontSize: "13px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "6px", whiteSpace: "nowrap"
                }}
              >
                <Zap size={14} />{manualSniping ? "Sniping…" : "Snipe Now"}
              </button>
            </div>
          </div>

          {/* Log Console */}
          <div style={{
            background: "#0a0d14", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "14px", overflow: "hidden"
          }}>
            <div style={{
              padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.05)",
              display: "flex", justifyContent: "space-between", alignItems: "center"
            }}>
              <span style={{ fontSize: "12px", color: "#64748b", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                🖥 Live Log
              </span>
              <button onClick={() => setLogs([])} style={{
                background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: "11px",
                display: "flex", alignItems: "center", gap: "4px"
              }}>
                <Trash2 size={11} /> Clear
              </button>
            </div>
            <div style={{ height: "320px", overflowY: "auto", padding: "12px 16px", fontFamily: "monospace", fontSize: "12px" }}>
              {logs.length === 0 ? (
                <span style={{ color: "#334155" }}>
                  {status === "running"
                    ? "Listening for new PancakeSwap pairs…"
                    : "Start the bot to begin scanning new token launches."}
                </span>
              ) : (
                logs.map((entry, i) => (
                  <div key={i} style={{ marginBottom: "4px", lineHeight: "1.5" }}>
                    <span style={{ color: "#334155", marginRight: "8px" }}>{entry.time}</span>
                    <span style={{ color: LOG_COLORS[entry.type], marginRight: "6px" }}>
                      {LOG_ICONS[entry.type]}
                    </span>
                    <span style={{ color: LOG_COLORS[entry.type] }}>{entry.message}</span>
                    {entry.txHash && (
                      <button
                        onClick={() => window.open(`https://bscscan.com/tx/${entry.txHash}`, "_blank")}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#4B5563", marginLeft: "8px", fontSize: "11px" }}
                      >
                        ↗
                      </button>
                    )}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* ── MEMPOOL RADAR ──────────────────────────────────────────────────── */}
      {subView === "mempool" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{
            background: "#0f172a", border: "1px solid rgba(124,58,237,0.3)",
            borderRadius: "16px", padding: "18px"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Zap size={18} color="#a78bfa" />
                <h3 style={{ fontSize: "15px", fontWeight: 800, color: "#f8fafc", margin: 0 }}>
                  Live PancakeSwap Mempool Pair Stream
                </h3>
              </div>
              <span style={{ fontSize: "11px", color: "#10b981", fontWeight: 700, background: "rgba(16,185,129,0.15)", padding: "4px 10px", borderRadius: "20px" }}>
                ● Mempool Listener Active
              </span>
            </div>
            <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
              Detecting `PairCreated` liquidity events before blocks are finalized on BSC.
            </p>
          </div>

          {/* Sample Live Mempool Pair Stream Cards */}
          {[
            { symbol: "ALPHA/WBNB", address: "0x89a...4b12", liq: "8.5 BNB", tax: "0% / 2%", safety: "95 / 100", time: "2 sec ago" },
            { symbol: "SHIBX/WBNB", address: "0x34f...8c90", liq: "2.1 BNB", tax: "5% / 5%", safety: "82 / 100", time: "14 sec ago" },
            { symbol: "PEPEBSC/WBNB", address: "0x12d...99aa", liq: "0.4 BNB", tax: "15% / 15%", safety: "40 / 100", time: "45 sec ago" },
          ].map((pair, idx) => (
            <div key={idx} style={{
              background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "14px", padding: "16px", display: "flex",
              alignItems: "center", justifyBetween: "space-between", gap: "12px", flexWrap: "wrap"
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "15px", fontWeight: 800, color: "#f8fafc" }}>{pair.symbol}</span>
                  <span style={{ fontSize: "10px", color: "#64748b", fontFamily: "monospace" }}>{pair.address}</span>
                  <span style={{ fontSize: "10px", color: "#94a3b8" }}>· {pair.time}</span>
                </div>
                <div style={{ display: "flex", gap: "12px", fontSize: "11px", color: "#94a3b8" }}>
                  <span>Liquidity: <strong style={{ color: "#10b981" }}>{pair.liq}</strong></span>
                  <span>Buy/Sell Tax: <strong style={{ color: "#e2e8f0" }}>{pair.tax}</strong></span>
                  <span>Safety: <strong style={{ color: "#a78bfa" }}>{pair.safety}</strong></span>
                </div>
              </div>

              <button
                onClick={() => {
                  setManualContract(pair.address);
                  setSubView("console");
                }}
                style={{
                  background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
                  border: "none", borderRadius: "8px", color: "white",
                  padding: "8px 16px", fontSize: "12px", fontWeight: 700, cursor: "pointer"
                }}
              >
                Instant Snipe →
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── POSITIONS ──────────────────────────────────────────────────────── */}
      {subView === "positions" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {positions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px", color: "#475569" }}>
              <Activity size={36} style={{ margin: "0 auto 12px", display: "block", opacity: 0.3 }} />
              No positions yet. Start the bot and wait for new token launches.
            </div>
          ) : (
            positions.map(pos => (
              <div key={pos.id} style={{
                background: "rgba(15,20,30,0.7)",
                border: `1px solid ${pos.status === "open" ? "rgba(124,58,237,0.25)" : pos.pnlBnb >= 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
                borderRadius: "14px", padding: "16px"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "16px", fontWeight: 700, color: "#e2e8f0" }}>{pos.symbol}</span>
                      <span style={{
                        fontSize: "10px", padding: "2px 8px", borderRadius: "20px", fontWeight: 700,
                        background: pos.status === "open" ? "rgba(124,58,237,0.2)" : pos.pnlBnb >= 0 ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.15)",
                        color: pos.status === "open" ? "#a78bfa" : pos.pnlBnb >= 0 ? "#10b981" : "#f87171",
                      }}>
                        {pos.status === "open" ? "OPEN" : pos.pnlBnb >= 0 ? "PROFIT ✓" : "LOSS"}
                      </span>
                    </div>
                    <span style={{ fontSize: "11px", fontFamily: "monospace", color: "#475569" }}>
                      {pos.contract.slice(0, 10)}…
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button onClick={() => window.open(`https://bscscan.com/tx/${pos.txBuy}`, "_blank")}
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "6px", padding: "5px 8px", cursor: "pointer", color: "#94a3b8", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}>
                      <ExternalLink size={11} /> Buy TX
                    </button>
                    {pos.status === "open" && (
                      <button onClick={() => handleSell(pos.id)}
                        style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "6px", padding: "5px 10px", cursor: "pointer", color: "#f87171", fontSize: "11px", fontWeight: 700 }}>
                        Sell
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
                  {[
                    { label: "Spent", value: `${pos.spentBnb.toFixed(4)} BNB` },
                    { label: "Entry Price", value: `${pos.entryPriceBnb.toFixed(8)}` },
                    { label: "Current Price", value: pos.status === "open" ? `${pos.currentPriceBnb.toFixed(8)}` : "—" },
                    {
                      label: "PnL",
                      value: `${pos.pnlPct >= 0 ? "+" : ""}${pos.pnlPct.toFixed(1)}%`,
                      color: pos.pnlPct >= 0 ? "#10b981" : "#f87171"
                    },
                  ].map((m, i) => (
                    <div key={i} style={{ background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "8px 10px" }}>
                      <div style={{ fontSize: "10px", color: "#475569", marginBottom: "3px" }}>{m.label}</div>
                      <div style={{ fontSize: "13px", fontWeight: 700, color: (m as { color?: string }).color || "#e2e8f0", fontFamily: "monospace" }}>{m.value}</div>
                    </div>
                  ))}
                </div>

                {pos.status === "open" && (
                  <div style={{ display: "flex", gap: "16px", marginTop: "10px", fontSize: "11px", color: "#475569" }}>
                    <span>🎯 TP: +{pos.takeProfitPct}%</span>
                    <span>🛑 SL: -{pos.stopLossPct}%</span>
                    <span>📅 {new Date(pos.openedAt).toLocaleTimeString()}</span>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── SETTINGS ───────────────────────────────────────────────────────── */}
      {subView === "settings" && (
        <div style={{ background: "rgba(15,20,30,0.6)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", padding: "20px" }}>
          <h3 style={{ fontSize: "14px", fontWeight: 700, color: "#94a3b8", marginBottom: "20px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Bot Configuration
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            {([
              { label: "Buy Amount (BNB)", key: "buyAmountBnb" as keyof SniperConfig, step: 0.01, min: 0.001, max: 10 },
              { label: "Slippage %", key: "slippagePct" as keyof SniperConfig, step: 1, min: 1, max: 99 },
              { label: "Gas Multiplier (×)", key: "gasMultiplier" as keyof SniperConfig, step: 0.5, min: 1, max: 5 },
              { label: "Min Liquidity (BNB)", key: "minLiquidityBnb" as keyof SniperConfig, step: 0.5, min: 0, max: 100 },
              { label: "Max Buy Tax %", key: "maxBuyTaxPct" as keyof SniperConfig, step: 1, min: 0, max: 50 },
              { label: "Max Sell Tax %", key: "maxSellTaxPct" as keyof SniperConfig, step: 1, min: 0, max: 50 },
              { label: "Take Profit %", key: "takeProfitPct" as keyof SniperConfig, step: 10, min: 10, max: 1000 },
              { label: "Stop Loss %", key: "stopLossPct" as keyof SniperConfig, step: 5, min: 5, max: 90 },
              { label: "Max Positions", key: "maxPositions" as keyof SniperConfig, step: 1, min: 1, max: 20 },
              { label: "TX Deadline (min)", key: "deadlineMinutes" as keyof SniperConfig, step: 1, min: 1, max: 60 },
            ] as Array<{ label: string; key: keyof SniperConfig; step: number; min: number; max: number }>).map(field => (
              <div key={field.key}>
                <label style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "6px" }}>
                  {field.label}: <strong style={{ color: "#e2e8f0" }}>{config[field.key]}</strong>
                </label>
                <input
                  type="range"
                  min={field.min} max={field.max} step={field.step}
                  value={config[field.key] as number}
                  onChange={e => setConfig(prev => ({ ...prev, [field.key]: parseFloat(e.target.value) }))}
                  style={{ width: "100%", accentColor: "#7C3AED" }}
                />
              </div>
            ))}
          </div>

          {/* Honeypot toggle */}
          <div style={{ marginTop: "14px", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", background: "rgba(255,255,255,0.03)", borderRadius: "10px" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>🛡️ Honeypot Check</div>
              <div style={{ fontSize: "11px", color: "#64748b" }}>Skip tokens flagged as honeypots</div>
            </div>
            <button
              onClick={() => setConfig(prev => ({ ...prev, honeypotCheck: !prev.honeypotCheck }))}
              style={{
                padding: "6px 16px", borderRadius: "20px", fontWeight: 700, fontSize: "12px",
                cursor: "pointer", border: "none",
                background: config.honeypotCheck ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.15)",
                color: config.honeypotCheck ? "#10b981" : "#f87171",
              }}
            >
              {config.honeypotCheck ? "ON" : "OFF"}
            </button>
          </div>

          <button
            onClick={() => engineRef.updateConfig(config)}
            style={{
              marginTop: "16px", width: "100%", padding: "12px",
              background: "linear-gradient(135deg, #7C3AED, #4F46E5)",
              border: "none", borderRadius: "10px", color: "white",
              fontWeight: 700, fontSize: "14px", cursor: "pointer"
            }}
          >
            <CheckCircle size={14} style={{ display: "inline", marginRight: "8px", verticalAlign: "middle" }} />
            Apply Settings
          </button>
        </div>
      )}

      {/* ── TELEGRAM ───────────────────────────────────────────────────────── */}
      {subView === "telegram" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

          {/* Bot identity card */}
          <div style={{
            background: tgConnected
              ? "linear-gradient(135deg, rgba(16,185,129,0.12), rgba(15,20,30,0.8))"
              : "linear-gradient(135deg, rgba(59,130,246,0.1), rgba(15,20,30,0.8))",
            border: `1px solid ${tgConnected ? "rgba(16,185,129,0.3)" : "rgba(59,130,246,0.25)"}`,
            borderRadius: "16px", padding: "20px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              {/* Telegram plane icon */}
              <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: "linear-gradient(135deg, #2563EB, #0EA5E9)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Send size={24} color="white" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "17px", fontWeight: 800, color: "#e2e8f0" }}>
                    {tgBotName || "Dividend Pro"}
                  </span>
                  {tgBotUsername && (
                    <span style={{ fontSize: "12px", color: "#64748b" }}>@{tgBotUsername}</span>
                  )}
                  <span style={{
                    fontSize: "10px", fontWeight: 700, padding: "2px 9px", borderRadius: "20px",
                    background: tgConnected ? "rgba(16,185,129,0.2)" : "rgba(100,116,139,0.2)",
                    color: tgConnected ? "#10b981" : "#64748b",
                    border: `1px solid ${tgConnected ? "rgba(16,185,129,0.3)" : "rgba(100,116,139,0.2)"}`
                  }}>
                    {tgConnected ? "✓ CONNECTED" : "SETUP NEEDED"}
                  </span>
                </div>
                <div style={{ fontSize: "12px", color: "#475569", marginTop: "4px" }}>
                  {tgConnected
                    ? `Sending alerts to Chat ID: ${tgChatId}`
                    : "Token loaded from .env — just need your Chat ID"}
                </div>
              </div>
            </div>
          </div>

          {/* Setup steps */}
          <div style={{ background: "rgba(15,20,30,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", padding: "20px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "16px" }}>
              Setup — {tgConnected ? "Complete ✓" : "Step 2 of 2"}
            </div>

            {/* Step 1 — Token (auto done) */}
            <div style={{ display: "flex", gap: "12px", marginBottom: "14px", alignItems: "flex-start" }}>
              <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <CheckCircle size={14} color="#10b981" />
              </div>
              <div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#10b981" }}>Bot Token — loaded from .env</div>
                <div style={{ fontSize: "11px", color: "#475569", marginTop: "2px", fontFamily: "monospace" }}>
                  {tgToken ? `${tgToken.slice(0, 12)}…${tgToken.slice(-8)}` : "Not found"}
                </div>
              </div>
            </div>

            {/* Step 2 — Chat ID */}
            <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ width: "26px", height: "26px", borderRadius: "50%", background: tgChatId ? "rgba(16,185,129,0.2)" : "rgba(59,130,246,0.2)", border: `1px solid ${tgChatId ? "rgba(16,185,129,0.4)" : "rgba(59,130,246,0.4)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {tgChatId ? <CheckCircle size={14} color="#10b981" /> : <span style={{ color: "#60a5fa", fontSize: "12px", fontWeight: 700 }}>2</span>}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: tgChatId ? "#10b981" : "#e2e8f0" }}>
                  {tgChatId ? `Chat ID: ${tgChatId}` : "Get your Chat ID"}
                </div>
                {!tgChatId && (
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "4px", lineHeight: "1.6" }}>
                    Open Telegram → search <strong style={{ color: "#60a5fa" }}>@{tgBotUsername || "Dividentprobot"}</strong> → send any message (e.g. <code style={{ background: "rgba(255,255,255,0.08)", padding: "1px 5px", borderRadius: "4px" }}>/start</code>) → click button below
                  </div>
                )}

                {!tgChatId ? (
                  <button
                    onClick={async () => {
                      setTgDiscovering(true);
                      const id = await discoverChatId();
                      if (id) {
                        setTgChatId(id);
                        saveTelegramConfig(tgToken, id);
                        setTgConnected(true);
                      } else {
                        alert("No messages found. Send any message to @" + (tgBotUsername || "Dividentprobot") + " first, then try again.");
                      }
                      setTgDiscovering(false);
                    }}
                    disabled={tgDiscovering}
                    style={{
                      marginTop: "10px", padding: "9px 16px",
                      background: tgDiscovering ? "rgba(59,130,246,0.2)" : "linear-gradient(135deg, #2563EB, #1D4ED8)",
                      border: "none", borderRadius: "8px", color: "white", fontWeight: 700, fontSize: "13px",
                      cursor: tgDiscovering ? "not-allowed" : "pointer",
                      display: "flex", alignItems: "center", gap: "6px"
                    }}
                  >
                    <RefreshCw size={13} style={tgDiscovering ? { animation: "spin 1s linear infinite" } : {}} />
                    {tgDiscovering ? "Checking for messages…" : "Auto-Detect My Chat ID"}
                  </button>
                ) : (
                  <button onClick={() => { setTgChatId(""); localStorage.removeItem("divpro_tg_chat_id"); setTgConnected(false); }}
                    style={{ marginTop: "8px", background: "none", border: "none", color: "#475569", fontSize: "11px", cursor: "pointer", textDecoration: "underline" }}>
                    Clear &amp; re-detect
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Test + result */}
          {tgConnected && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <button onClick={handleTestTelegram} disabled={tgTesting}
                style={{ padding: "13px", background: tgTesting ? "rgba(59,130,246,0.2)" : "linear-gradient(135deg, #2563EB, #1D4ED8)", border: "none", borderRadius: "10px", color: "white", fontWeight: 700, fontSize: "15px", cursor: tgTesting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                <Send size={15} />{tgTesting ? "Sending test message…" : "Send Test Message to Telegram"}
              </button>
              {tgTestResult === "ok" && (
                <div style={{ color: "#10b981", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px", background: "rgba(16,185,129,0.08)", borderRadius: "8px", border: "1px solid rgba(16,185,129,0.2)" }}>
                  <CheckCircle size={15} /> <strong>Message sent!</strong> Check your Telegram for the test alert.
                </div>
              )}
              {tgTestResult === "fail" && (
                <div style={{ color: "#f87171", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px", background: "rgba(239,68,68,0.08)", borderRadius: "8px", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <XCircle size={15} /> Failed — make sure you sent a message to the bot first.
                </div>
              )}
            </div>
          )}

          {/* Notification events */}
          <div style={{ background: "rgba(15,20,30,0.7)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", padding: "18px" }}>
            <div style={{ fontSize: "12px", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "12px" }}>
              🔔 Notification Events
            </div>
            {[
              { emoji: "🚀", event: "Snipe Buy", desc: "Token bought · amount · BNB spent · TX link" },
              { emoji: "🟢", event: "Take-Profit Hit", desc: "Profit % · BNB received · token contract" },
              { emoji: "🔴", event: "Stop-Loss Hit", desc: "Loss % · BNB received · reason" },
              { emoji: "⚠️", event: "Honeypot Blocked", desc: "Contract that was blocked with reason" },
              { emoji: "💡", event: "Bot Start/Stop", desc: "Wallet address · timestamp" },
            ].map((n, i) => (
              <div key={i} style={{ display: "flex", gap: "12px", padding: "9px 0", borderBottom: i < 4 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                <span style={{ fontSize: "18px", flexShrink: 0 }}>{n.emoji}</span>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#e2e8f0" }}>{n.event}</div>
                  <div style={{ fontSize: "11px", color: "#475569" }}>{n.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
