import React, { useState } from "react";
import { Sparkles, Layers, TrendingUp, ArrowRight, CheckCircle2, X, Mail } from "lucide-react";

interface OnboardingWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPersona: (persona: "dividend" | "trading" | "research") => void;
}

export default function OnboardingWizard({ isOpen, onClose, onSelectPersona }: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [selectedGoal, setSelectedGoal] = useState<"dividend" | "trading" | "research">("dividend");
  const [email, setEmail] = useState("");

  if (!isOpen) return null;

  const personas = [
    {
      id: "dividend" as const,
      title: "Dividend Income Investor",
      icon: Layers,
      color: "border-emerald-500/50 bg-emerald-950/20 text-emerald-400",
      desc: "Track dividend yields, safety scores, DRIP compounding, and payout calendars for stocks and crypto staking."
    },
    {
      id: "trading" as const,
      title: "Active Trader & Analyst",
      icon: TrendingUp,
      color: "border-indigo-500/50 bg-indigo-950/20 text-indigo-400",
      desc: "Real-time price charts, options chains, backtesting, and AI-powered strategy analysis."
    },
    {
      id: "research" as const,
      title: "Web3 & MEV Researcher",
      icon: Sparkles,
      color: "border-purple-500/50 bg-purple-950/20 text-purple-400",
      desc: "BSC wallet tracking, MEV research dashboard, and on-chain settlement verification."
    }
  ];

  const handleComplete = () => {
    onSelectPersona(selectedGoal);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-fade-in">
      <div
        className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden glass-panel p-6"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-6">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100">Welcome to DividendPro</h2>
              <p className="text-xs text-slate-400">Step {step} of 3 — Set up your workspace</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-200">What is your primary investment focus?</h3>
            <div className="space-y-3">
              {personas.map((p) => {
                const Icon = p.icon;
                const isSelected = selectedGoal === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedGoal(p.id)}
                    className={`w-full flex items-start space-x-4 p-4 rounded-2xl border text-left transition ${
                      isSelected ? p.color : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-700"
                    }`}
                  >
                    <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm text-slate-100">{p.title}</span>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      </div>
                      <p className="text-xs text-slate-400 mt-1">{p.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="pt-4 flex justify-end">
              <button
                onClick={() => setStep(2)}
                className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-200">Stay updated on dividend opportunities?</h3>
            <p className="text-xs text-slate-400">Get weekly yield reports, ex-dividend alerts, and market analysis. Optional — skip if you prefer.</p>

            <div className="flex items-center space-x-3">
              <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 shrink-0">
                <Mail className="w-5 h-5 text-slate-400" />
              </div>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 px-4 py-3 border border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-500 bg-slate-950"
              />
            </div>

            <div className="pt-4 flex justify-between">
              <button
                onClick={() => setStep(3)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 text-sm transition"
              >
                Skip for now
              </button>
              <button
                onClick={() => setStep(3)}
                className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition"
              >
                <span>Continue</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 text-center py-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-100">Workspace Configured!</h3>
              <p className="text-xs text-slate-400 mt-2 max-w-md mx-auto">
                {selectedGoal === "dividend" && "We've loaded your dividend dashboard with yield tracking, DRIP calculator, and AI safety analysis."}
                {selectedGoal === "trading" && "We've loaded your trading workspace with real-time charts, backtesting, and AI strategy analysis."}
                {selectedGoal === "research" && "We've loaded the BSC wallet and MEV research dashboard with settlement verification."}
              </p>
              {email && (
                <p className="text-xs text-emerald-400 mt-2">We'll send weekly updates to {email}</p>
              )}
            </div>

            <button
              onClick={handleComplete}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-bold text-sm hover:brightness-110 transition shadow-lg shadow-emerald-500/20"
            >
              Launch DividendPro Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}