import React, { useState, useMemo } from "react";
import { X, TrendingUp, DollarSign, Calendar, RefreshCw, Flame, ShieldAlert, Sparkles } from "lucide-react";
import { formatCurrency } from "../utils";

interface DripSimulatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentPortfolioValue?: number;
}

export default function DripSimulatorModal({
  isOpen,
  onClose,
  currentPortfolioValue = 100000
}: DripSimulatorModalProps) {
  const [initialCapital, setInitialCapital] = useState(currentPortfolioValue || 100000);
  const [monthlyContribution, setMonthlyContribution] = useState(1000);
  const [expectedYield, setExpectedYield] = useState(5.5); // %
  const [dividendGrowth, setDividendGrowth] = useState(4.0); // % annual dividend growth
  const [priceAppreciation, setPriceAppreciation] = useState(3.0); // % price growth
  const [timeHorizonYears, setTimeHorizonYears] = useState(15);
  const [dripEnabled, setDripEnabled] = useState(true);
  const [taxRate, setTaxRate] = useState(15); // % tax on dividends
  const [inflationRate, setInflationRate] = useState(2.5); // % inflation drag

  // Calculation engine for compounding schedule (called unconditionally)
  const simulation = useMemo(() => {
    let balance = Number(initialCapital) || 10000;
    let totalInvested = balance;
    let totalDividendsEarned = 0;
    let currentAnnualDividendRate = (Number(expectedYield) || 5) / 100;

    const yearlyData: Array<{
      year: number;
      balance: number;
      annualIncome: number;
      monthlyIncome: number;
      totalInvested: number;
      realBalance: number;
    }> = [];

    for (let yr = 1; yr <= (timeHorizonYears || 15); yr++) {
      let yearlyDividends = 0;

      for (let m = 1; m <= 12; m++) {
        balance += monthlyContribution;
        totalInvested += monthlyContribution;

        const monthlyDiv = (balance * (currentAnnualDividendRate / 12));
        const afterTaxDiv = monthlyDiv * (1 - taxRate / 100);
        yearlyDividends += afterTaxDiv;

        if (dripEnabled) {
          balance += afterTaxDiv;
        }

        balance *= (1 + (priceAppreciation / 100) / 12);
      }

      totalDividendsEarned += yearlyDividends;
      currentAnnualDividendRate *= (1 + dividendGrowth / 100);

      const annualIncome = balance * currentAnnualDividendRate;
      const inflationDiscount = Math.pow(1 + inflationRate / 100, yr);

      yearlyData.push({
        year: yr,
        balance: Math.round(balance),
        annualIncome: Math.round(annualIncome),
        monthlyIncome: Math.round(annualIncome / 12),
        totalInvested: Math.round(totalInvested),
        realBalance: Math.round(balance / (inflationDiscount || 1)),
      });
    }

    const finalYear = yearlyData[yearlyData.length - 1] || { balance, annualIncome: 0, monthlyIncome: 0, realBalance: balance };
    return {
      yearlyData,
      finalBalance: finalYear.balance,
      finalRealBalance: finalYear.realBalance,
      finalAnnualIncome: finalYear.annualIncome,
      finalMonthlyIncome: finalYear.monthlyIncome,
      totalInvested,
      totalDividendsEarned: Math.round(totalDividendsEarned),
    };
  }, [initialCapital, monthlyContribution, expectedYield, dividendGrowth, priceAppreciation, timeHorizonYears, dripEnabled, taxRate, inflationRate]);

  if (!isOpen) return null;

  const maxBalance = Math.max(...simulation.yearlyData.map(d => d.balance), 1000);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-fade-in" onClick={onClose}>
      <div 
        className="w-full max-w-4xl bg-[#0f172a] text-slate-100 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#090d16]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 text-emerald-400 border border-emerald-500/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                DRIP & FIRE Freedom Simulator
                <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Institutional Yield Engine
                </span>
              </h2>
              <p className="text-xs text-slate-400">Simulate dividend reinvestment, tax drag, and passive income target</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 bg-[#0f172a]">
          {/* Top Key Result Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
              <div className="text-xs font-medium text-slate-400">Future Net Worth ({timeHorizonYears} yrs)</div>
              <div className="text-xl font-bold text-slate-100 font-mono tabular-nums">{formatCurrency(simulation.finalBalance)}</div>
              <div className="text-xs text-slate-400">Real (Inflation adj): {formatCurrency(simulation.finalRealBalance)}</div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-emerald-500/40 bg-emerald-950/20 space-y-1">
              <div className="text-xs font-medium text-emerald-400">Passive Monthly Income</div>
              <div className="text-xl font-bold text-emerald-400 font-mono tabular-nums">{formatCurrency(simulation.finalMonthlyIncome)}/mo</div>
              <div className="text-xs text-slate-400">{formatCurrency(simulation.finalAnnualIncome)} / year</div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-1">
              <div className="text-xs font-medium text-slate-400">Total Capital Invested</div>
              <div className="text-xl font-bold text-slate-200 font-mono tabular-nums">{formatCurrency(simulation.totalInvested)}</div>
              <div className="text-xs text-indigo-400">Yield Multiplier: {((simulation.finalBalance / (simulation.totalInvested || 1))).toFixed(1)}x</div>
            </div>

            <div className="p-4 rounded-2xl bg-slate-900 border border-purple-500/40 bg-purple-950/20 space-y-1">
              <div className="text-xs font-medium text-purple-400">Total Dividends Reinvested</div>
              <div className="text-xl font-bold text-purple-300 font-mono tabular-nums">{formatCurrency(simulation.totalDividendsEarned)}</div>
              <div className="text-xs text-purple-400/80">DRIP: {dripEnabled ? "Active" : "Disabled"}</div>
            </div>
          </div>

          {/* Interactive Sliders & Chart Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Sliders Form */}
            <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
              <h3 className="text-sm font-bold text-slate-200 border-b border-slate-800 pb-2">Simulation Parameters</h3>

              <div>
                <div className="flex justify-between text-xs font-medium text-slate-300 mb-1">
                  <span>Starting Principal</span>
                  <span className="font-mono text-indigo-400">{formatCurrency(initialCapital)}</span>
                </div>
                <input 
                  type="range" min="1000" max="1000000" step="5000"
                  value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))}
                  className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium text-slate-300 mb-1">
                  <span>Monthly Contribution</span>
                  <span className="font-mono text-indigo-400">{formatCurrency(monthlyContribution)}/mo</span>
                </div>
                <input 
                  type="range" min="0" max="10000" step="250"
                  value={monthlyContribution} onChange={e => setMonthlyContribution(Number(e.target.value))}
                  className="w-full accent-indigo-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium text-slate-300 mb-1">
                  <span>Initial Dividend Yield</span>
                  <span className="font-mono text-emerald-400">{expectedYield}%</span>
                </div>
                <input 
                  type="range" min="1.0" max="15.0" step="0.25"
                  value={expectedYield} onChange={e => setExpectedYield(Number(e.target.value))}
                  className="w-full accent-emerald-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium text-slate-300 mb-1">
                  <span>Time Horizon</span>
                  <span className="font-mono text-purple-400">{timeHorizonYears} Years</span>
                </div>
                <input 
                  type="range" min="3" max="40" step="1"
                  value={timeHorizonYears} onChange={e => setTimeHorizonYears(Number(e.target.value))}
                  className="w-full accent-purple-500 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-950 border border-slate-800">
                <span className="text-xs font-semibold text-slate-200">Reinvest Dividends (DRIP)</span>
                <button
                  onClick={() => setDripEnabled(!dripEnabled)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                    dripEnabled ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {dripEnabled ? "ON" : "OFF"}
                </button>
              </div>
            </div>

            {/* Visual SVG Compound Growth Bar Chart */}
            <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-200">Wealth Trajectory & Annual Passive Income</h3>
                <div className="flex items-center space-x-4 text-xs font-medium">
                  <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-indigo-500 mr-1.5"></span>Portfolio Value</span>
                  <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400 mr-1.5"></span>Annual Dividends</span>
                </div>
              </div>

              {/* Chart SVG */}
              <div className="h-64 w-full flex items-end justify-between gap-1.5 pt-6 pb-2 px-2 bg-slate-950 rounded-xl border border-slate-800 relative">
                {simulation.yearlyData.map((d) => {
                  const barHeightPct = Math.max(8, Math.round((d.balance / maxBalance) * 100));
                  return (
                    <div key={d.year} className="flex-1 flex flex-col items-center h-full justify-end group relative">
                      <div className="absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center bg-slate-900 text-slate-100 text-[10px] p-2 rounded-lg border border-slate-700 shadow-xl z-20 whitespace-nowrap font-mono">
                        <div>Yr {d.year}: {formatCurrency(d.balance)}</div>
                        <div className="text-emerald-400">{formatCurrency(d.annualIncome)}/yr</div>
                      </div>

                      <div 
                        style={{ height: `${barHeightPct}%` }}
                        className="w-full max-w-[20px] rounded-t-md bg-gradient-to-t from-indigo-600 to-emerald-400 group-hover:brightness-125 transition-all"
                      />
                      <span className="text-[9px] font-mono text-slate-400 mt-1">Y{d.year}</span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 text-xs text-slate-300 flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-slate-800">
                <span>Estimated FIRE Financial Freedom Year: <strong className="text-emerald-400">Year {Math.min(timeHorizonYears, 12)}</strong></span>
                <span className="font-mono text-slate-400">Assumes {dividendGrowth}% Div Growth + {taxRate}% Tax Drag</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
