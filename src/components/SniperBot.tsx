import React, { useEffect, useState } from "react";
import { AlertTriangle, Bell, Lock, Server, ShieldCheck } from "lucide-react";
import { getTelegramStatus, testTelegramConnection } from "../services/telegram";

const LEGACY_WALLET_KEYS = [
  "divpro_sniper_wallet_session",
  "divpro_sniper_wallet_persistent",
  "divpro_sniper_wallet",
];

export default function SniperBot() {
  const [telegramConfigured, setTelegramConfigured] = useState(false);
  const [telegramNotice, setTelegramNotice] = useState("");
  const [legacyWalletPresent, setLegacyWalletPresent] = useState(false);

  useEffect(() => {
    getTelegramStatus().then(status => setTelegramConfigured(status.configured));
    setLegacyWalletPresent(LEGACY_WALLET_KEYS.some(
      key => Boolean(localStorage.getItem(key) || sessionStorage.getItem(key)),
    ));
  }, []);

  const testTelegram = async () => {
    setTelegramNotice("Testing authenticated server dispatch…");
    const delivered = await testTelegramConnection();
    setTelegramNotice(delivered ? "Server-side test delivered." : "Delivery failed. Sign in and verify backend configuration.");
  };

  const clearLegacyWallet = () => {
    const approved = window.confirm(
      "This permanently removes the legacy encrypted sniper-wallet data from this browser. Continue only if you have securely backed up the source wallet recovery phrase or private key.",
    );
    if (!approved) return;
    LEGACY_WALLET_KEYS.forEach(key => {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    setLegacyWalletPresent(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{
        background: "linear-gradient(135deg, rgba(245,158,11,0.14), rgba(124,58,237,0.1))",
        border: "1px solid rgba(245,158,11,0.4)", borderRadius: "18px", padding: "22px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
          <Lock size={22} color="#f59e0b" />
          <h2 style={{ margin: 0, color: "#f8fafc", fontSize: "19px", fontWeight: 900 }}>
            Native Sniper Execution Is Server-Managed and Deployment-Gated
          </h2>
        </div>
        <p style={{ color: "#cbd5e1", fontSize: "13px", lineHeight: 1.6, margin: 0 }}>
          No buy, sell, approval, private-key import, or wallet-storage action is exposed in the browser.
          The implemented Rust/C++ worker supports allowlisted atomic arbitrage and consensual backruns only; live mode remains off until the regional workers, private relays, signer, and executor contract complete the authorized canary smoke test.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "12px" }}>
        {[
          { icon: <ShieldCheck size={19} />, title: "Execution", value: "CODED / NOT DEPLOYED", detail: "Atomic V2 arbitrage reverts below minimum profit." },
          { icon: <Lock size={19} />, title: "Wallet secrets", value: "SERVER ONLY", detail: "The browser never accepts or receives the execution key." },
          { icon: <Server size={19} />, title: "Evidence adapter", value: "IMPLEMENTED", detail: "Finalized receipt, calldata, event, and profit amount must reconcile." },
        ].map(item => (
          <div key={item.title} style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "14px", padding: "16px" }}>
            <div style={{ color: "#a78bfa", display: "flex", alignItems: "center", gap: "7px", fontSize: "12px", fontWeight: 800 }}>
              {item.icon}{item.title}
            </div>
            <div style={{ color: "#f59e0b", fontSize: "14px", fontWeight: 900, marginTop: "8px" }}>{item.value}</div>
            <div style={{ color: "#64748b", fontSize: "11px", marginTop: "4px" }}>{item.detail}</div>
          </div>
        ))}
      </div>

      {legacyWalletPresent && (
        <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: "14px", padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#fca5a5", fontWeight: 800, fontSize: "13px" }}>
            <AlertTriangle size={18} /> Legacy encrypted wallet data exists in this browser
          </div>
          <p style={{ color: "#94a3b8", fontSize: "12px", lineHeight: 1.5 }}>
            The truth-layer release never reads or uses it. Back up the wallet recovery material independently before removing this legacy browser data.
          </p>
          <button onClick={clearLegacyWallet} style={{ background: "rgba(239,68,68,0.16)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "9px", color: "#fca5a5", padding: "9px 13px", fontWeight: 800, cursor: "pointer" }}>
            Remove Legacy Browser Wallet Data
          </button>
        </div>
      )}

      <div style={{ background: "#0f172a", border: "1px solid rgba(59,130,246,0.3)", borderRadius: "14px", padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#93c5fd", fontWeight: 800 }}>
          <Bell size={18} /> Telegram: {telegramConfigured ? "server configured" : "not configured or sign-in required"}
        </div>
        <p style={{ color: "#64748b", fontSize: "12px" }}>The bot token and chat ID remain server-side. This test contains no trade or profit claim.</p>
        <button disabled={!telegramConfigured} onClick={testTelegram} style={{ background: "#2563eb", border: "none", borderRadius: "9px", color: "white", padding: "9px 13px", fontWeight: 800, cursor: telegramConfigured ? "pointer" : "not-allowed", opacity: telegramConfigured ? 1 : 0.5 }}>
          Test Server Dispatch
        </button>
        {telegramNotice && <div style={{ color: "#94a3b8", fontSize: "12px", marginTop: "9px" }}>{telegramNotice}</div>}
      </div>
    </div>
  );
}
