import React from "react";
import { X, Check, Zap, Crown, ShieldCheck, Sparkles } from "lucide-react";

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PricingModal({ isOpen, onClose }: PricingModalProps) {
  if (!isOpen) return null;

  const tiers = [
    {
      name: "Starter",
      price: "$0",
      period: "Free Forever",
      desc: "Essential dividend tracking & monthly payout calendar",
      buttonText: "Current Plan",
      buttonStyle: "bg-slate-800 text-slate-300 cursor-default",
      features: [
        "Portfolio yield tracker",
        "Quarterly dividend calendar",
        "5 Gemini AI stock audits / month",
        "Standard market data refresh"
      ]
    },
    {
      name: "Pro Investor",
      price: "$29",
      period: "/ month",
      popular: true,
      desc: "For active yield investors seeking institutional safety analytics",
      buttonText: "Upgrade to Pro",
      buttonStyle: "bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-bold hover:brightness-110 shadow-lg shadow-emerald-500/20",
      features: [
        "Unlimited Gemini AI fundamental audits",
        "Covered Call & Cash-Secured Put scanner",
        "Interactive DRIP & FIRE Freedom Simulator",
        "Real-time DeFi yield pool streaming",
        "Custom Telegram instant yield alerts"
      ]
    },
    {
      name: "Whale / Bot Tier",
      price: "$99",
      period: "/ month",
      desc: "Automated Web3 Mempool Sniping & AI Investment Swarm",
      buttonText: "Unlock Whale Tier",
      buttonStyle: "bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold hover:brightness-110 shadow-lg shadow-purple-500/20",
      features: [
        "BSC Automated Token Sniper Bot",
        "Low-latency PancakeSwap router fees bypass",
        "Vibe Trading AI Agent Swarm backtester",
        "Multi-wallet auto-rebalancing engine",
        "Priority API bandwidth & dedicated WebSocket"
      ]
    }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in" onClick={onClose}>
      <div 
        className="w-full max-w-5xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden glass-panel p-6"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/30">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">Upgrade DividendPro Tier</h2>
              <p className="text-xs text-slate-400">Unlock institutional analytics, options labs, and automated Web3 bots</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pricing Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((t) => (
            <div 
              key={t.name}
              className={`p-6 rounded-2xl border flex flex-col justify-between relative transition ${
                t.popular ? "border-emerald-500/60 bg-emerald-950/10 shadow-xl" : "border-slate-800 bg-slate-950/50"
              }`}
            >
              {t.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-500 text-slate-950 shadow-md">
                  Most Popular
                </span>
              )}

              <div>
                <h3 className="text-base font-bold text-slate-100">{t.name}</h3>
                <p className="text-xs text-slate-400 mt-1 min-h-[32px]">{t.desc}</p>

                <div className="my-4 flex items-baseline space-x-1">
                  <span className="text-3xl font-extrabold text-slate-100 font-mono">{t.price}</span>
                  <span className="text-xs text-slate-400">{t.period}</span>
                </div>

                <div className="space-y-2.5 border-t border-slate-800/80 pt-4 my-4">
                  {t.features.map((f) => (
                    <div key={f} className="flex items-start space-x-2 text-xs text-slate-300">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <button 
                className={`w-full py-2.5 rounded-xl text-xs transition mt-4 ${t.buttonStyle}`}
                onClick={() => alert(`Subscribed to ${t.name} plan!`)}
              >
                {t.buttonText}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
