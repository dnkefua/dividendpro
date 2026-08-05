import React, { useState } from "react";
import { X, Check, Crown, Sparkles, BarChart2 } from "lucide-react";

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTier?: string;
}

export default function PricingModal({ isOpen, onClose, currentTier = "free" }: PricingModalProps) {
  const [processingTier, setProcessingTier] = useState<string | null>(null);

  if (!isOpen) return null;

  const tiers = [
    {
      id: "free",
      name: "Starter",
      price: "$0",
      period: "Free Forever",
      desc: "Essential dividend tracking & AI analysis",
      buttonText: currentTier === "free" ? "Current Plan" : "Downgrade",
      buttonStyle: "bg-slate-800 text-slate-300 cursor-default",
      features: [
        "Portfolio yield tracker with live quotes",
        "Dividend calendar & payout tracking",
        "5 Gemini AI stock audits / month",
        "Market scanner with real-time movers",
        "Watchlist with price alerts",
        "DRIP compound growth calculator"
      ]
    },
    {
      id: "pro",
      name: "Pro Investor",
      price: "$15",
      period: "/ month",
      popular: true,
      desc: "For active yield investors seeking institutional analytics",
      buttonText: currentTier === "pro" ? "Current Plan" : "Upgrade to Pro",
      buttonStyle: currentTier === "pro"
        ? "bg-slate-800 text-slate-300 cursor-default"
        : "bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-bold hover:brightness-110 shadow-lg shadow-emerald-500/20",
      features: [
        "Unlimited Gemini AI fundamental audits",
        "Real-time options chain data & covered calls",
        "US Treasury yield macro overlays",
        "Interactive DRIP & FIRE Freedom Simulator",
        "Crypto yield pool data via DefiLlama",
        "Strategy Lab backtesting engine",
        "Priority market data refresh"
      ]
    },
    {
      id: "institutional",
      name: "Institutional",
      price: "$99",
      period: "/ month",
      desc: "API access, bulk screening, custom strategies",
      buttonText: currentTier === "institutional" ? "Current Plan" : "Contact Sales",
      buttonStyle: currentTier === "institutional"
        ? "bg-slate-800 text-slate-300 cursor-default"
        : "bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold hover:brightness-110 shadow-lg shadow-purple-500/20",
      features: [
        "Everything in Pro Investor",
        "REST API access for programmatic screening",
        "Bulk dividend safety screening (100+ stocks)",
        "Custom strategy backtesting with export",
        "BSC wallet monitoring & settlement verification",
        "Webhook price & dividend alerts",
        "Dedicated support & onboarding"
      ]
    }
  ];

  const handleSelectTier = (tierId: string) => {
    if (tierId === currentTier) return;
    setProcessingTier(tierId);

    // In production, this would redirect to Stripe Checkout:
    // const stripe = await loadStripe(process.env.VITE_STRIPE_PUBLISHABLE_KEY!);
    // const { sessionId } = await fetch('/api/stripe/checkout', { method: 'POST', ... });
    // stripe.redirectToCheckout({ sessionId });

    // For now, show a coming-soon message
    setTimeout(() => {
      alert(
        tierId === "institutional"
          ? "Institutional tier requires setting up a Stripe payment flow. Please contact support@dividendpro.app to get started."
          : "Payment integration coming soon! Your account will be upgraded once Stripe Checkout is configured. For now, all Pro features are available during the beta period."
      );
      setProcessingTier(null);
    }, 500);
  };

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
              <h2 className="text-lg font-bold text-slate-100">Choose Your Plan</h2>
              <p className="text-xs text-slate-400">Unlock institutional-grade dividend analytics & AI research</p>
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
              key={t.id}
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
                onClick={() => handleSelectTier(t.id)}
                disabled={processingTier === t.id}
              >
                {processingTier === t.id ? "Processing..." : t.buttonText}
              </button>
            </div>
          ))}
        </div>

        {/* Trust footer */}
        <div className="mt-6 text-center text-[11px] text-slate-500">
          All plans include Firebase-authenticated data sync. Cancel anytime. DividendPro does not provide financial advice — all analytics are for research purposes only.
        </div>
      </div>
    </div>
  );
}