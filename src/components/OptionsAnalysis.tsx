import React, { useEffect, useState } from "react";
import { Info, TrendingUp, AlertTriangle } from "lucide-react";

interface OptionContract {
  strike: number;
  expiry: string;
  premium: number;
  impliedVol: number;
}

interface OptionsAnalysisProps {
  symbol: string;
}

export function OptionsAnalysis({ symbol }: OptionsAnalysisProps) {
  const [loading, setLoading] = useState(true);
  const [chain, setChain] = useState<OptionContract[]>([]);
  const [basePrice, setBasePrice] = useState(0);
  const [environment, setEnvironment] = useState("UNKNOWN");

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch(`/api/lse/options?symbol=${symbol}`)
      .then(res => res.json())
      .then(data => {
        if (mounted) {
          setChain(data.chain || []);
          setBasePrice(data.currentPrice || 0);
          setEnvironment(data.environment || "UNKNOWN");
          setLoading(false);
        }
      })
      .catch(err => {
        console.error("Failed to load options", err);
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (chain.length === 0) {
    return (
      <div className="p-6 text-center text-on-surface-variant bg-surface rounded-2xl">
        No options data available for {symbol}.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {environment === "SIMULATION" && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs font-bold text-amber-500">
          SIMULATED OPTIONS MODEL — these are static examples, not live quotes or executable contracts.
        </div>
      )}
      <div className="bg-secondary-container/30 border border-secondary-container rounded-2xl p-4 flex gap-4 items-start">
        <div className="p-2 bg-secondary/10 rounded-lg text-secondary mt-1">
          <Info size={20} />
        </div>
        <div>
          <h4 className="text-sm font-bold text-on-surface mb-1">Covered Call Strategy</h4>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            Generate additional yield by selling Out-Of-The-Money (OTM) call options against your shares. 
            In a real covered call, premium and assignment outcomes depend on an actual broker fill. The figures below are educational simulations.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-outline-variant text-[10px] uppercase font-mono tracking-wider text-on-surface-variant">
              <th className="pb-3 font-semibold px-4">Strike</th>
              <th className="pb-3 font-semibold px-4">Expiry</th>
              <th className="pb-3 font-semibold px-4 text-right">Premium</th>
              <th className="pb-3 font-semibold px-4 text-right">Ann. Yield</th>
            </tr>
          </thead>
          <tbody>
            {chain.map((opt, i) => {
              // Calculate rough annualized yield: (Premium / BasePrice) * (365 / Days)
              // Assuming 30 days for mock data
              const yieldPct = ((opt.premium / basePrice) * (365 / 30) * 100).toFixed(1);
              const isHighYield = parseFloat(yieldPct) > 15;

              return (
                <tr key={i} className="border-b border-outline-variant/30 hover:bg-surface/50 transition-colors group">
                  <td className="py-4 px-4">
                    <span className="font-bold text-on-surface">${opt.strike.toFixed(2)}</span>
                    <div className="text-[10px] text-on-surface-variant mt-0.5">
                      +{((opt.strike - basePrice) / basePrice * 100).toFixed(1)}% OTM
                    </div>
                  </td>
                  <td className="py-4 px-4 text-sm text-on-surface">{opt.expiry}</td>
                  <td className="py-4 px-4 text-right font-medium text-primary">
                    ${opt.premium.toFixed(2)}
                  </td>
                  <td className="py-4 px-4 text-right">
                    <div className="inline-flex items-center gap-1.5 font-bold text-secondary">
                      {isHighYield ? <AlertTriangle size={14} className="text-error" /> : <TrendingUp size={14} />}
                      {yieldPct}%
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
