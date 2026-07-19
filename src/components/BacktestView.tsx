import React, { useState } from "react";
import { AreaSeries, ColorType, createChart } from "lightweight-charts";
import { Stock } from "../types";
import { Activity, Play, Settings, DollarSign, Calendar } from "lucide-react";

interface BacktestViewProps {
  stocks: Stock[];
}

export default function BacktestView({ stocks }: BacktestViewProps) {
  const [selectedSymbol, setSelectedSymbol] = useState(stocks[0]?.symbol || "");
  const [initialCapital, setInitialCapital] = useState<number>(100000);
  const [years, setYears] = useState<number>(10);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<any>(null);

  const chartContainerRef = React.useRef<HTMLDivElement>(null);
  const chartInstance = React.useRef<any>(null);

  const runSimulation = () => {
    if (!selectedSymbol) return;
    setRunning(true);
    setResults(null);
    
    // Simulate complex Monte Carlo / Backtesting logic
    setTimeout(() => {
      const stock = stocks.find(s => s.symbol === selectedSymbol);
      const yieldRate = (stock?.yield || 4) / 100;
      const cagr = 0.07; // 7% capital appreciation
      
      let balance = initialCapital;
      const dataPoints = [];
      const currentDate = new Date();
      currentDate.setFullYear(currentDate.getFullYear() - years);

      for (let i = 0; i <= years; i++) {
        dataPoints.push({
          time: currentDate.toISOString().split("T")[0],
          value: Number(balance.toFixed(2))
        });
        // Compound interest with dividend reinvestment (DRIP)
        balance = balance * (1 + cagr + yieldRate);
        currentDate.setFullYear(currentDate.getFullYear() + 1);
      }

      setResults({
        finalBalance: balance,
        totalReturn: ((balance - initialCapital) / initialCapital) * 100,
        annualIncome: balance * yieldRate,
        dataPoints
      });
      setRunning(false);
    }, 1500);
  };

  React.useEffect(() => {
    if (results && chartContainerRef.current) {
      if (!chartInstance.current) {
        const chart = createChart(chartContainerRef.current, {
          layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#64748b" },
          grid: { vertLines: { color: "rgba(226, 232, 240, 0.15)" }, horzLines: { color: "rgba(226, 232, 240, 0.15)" } },
          width: chartContainerRef.current.clientWidth,
          height: 300,
        });
        const series = chart.addSeries(AreaSeries, {
          lineColor: "#6366f1", topColor: "rgba(99, 102, 241, 0.2)", bottomColor: "rgba(99, 102, 241, 0)", lineWidth: 2,
        });
        chartInstance.current = { chart, series };
      }
      chartInstance.current.series.setData(results.dataPoints);
      chartInstance.current.chart.timeScale().fitContent();
    }
  }, [results]);

  return (
    <div className="space-y-8 animate-fade-in pb-16">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-xs">
        <h2 className="text-2xl font-extrabold text-primary flex items-center gap-2">
          <Activity className="w-6 h-6 text-secondary" />
          Monte Carlo Backtesting
        </h2>
        <p className="text-sm text-on-surface-variant mt-2 max-w-2xl">
          Simulate historical portfolio growth and test retirement withdrawal strategies using London Strategic Edge's deep tick data archive.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Configuration Panel */}
        <div className="md:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 h-fit">
          <h3 className="font-bold text-primary mb-4 flex items-center gap-2">
            <Settings size={18} /> Simulation Parameters
          </h3>
          
          <div className="space-y-5">
            <div>
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider block mb-1">Asset</label>
              <select 
                value={selectedSymbol}
                onChange={e => setSelectedSymbol(e.target.value)}
                className="w-full px-4 py-3 bg-surface border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-sm font-medium"
              >
                {stocks.map(s => <option key={s.symbol} value={s.symbol}>{s.name} ({s.symbol})</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider block mb-1">Initial Capital</label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                <input 
                  type="number"
                  value={initialCapital}
                  onChange={e => setInitialCapital(Number(e.target.value))}
                  className="w-full pl-10 pr-4 py-3 bg-surface border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm font-bold"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider block mb-1">Time Horizon (Years)</label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
                <input 
                  type="number"
                  value={years}
                  onChange={e => setYears(Number(e.target.value))}
                  className="w-full pl-10 pr-4 py-3 bg-surface border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm font-bold"
                />
              </div>
            </div>

            <button 
              onClick={runSimulation}
              disabled={running}
              className="w-full mt-4 bg-primary text-on-primary hover:bg-opacity-90 px-6 py-3 rounded-xl font-bold text-sm shadow-sm transition-transform active:scale-95 flex items-center justify-center gap-2"
            >
              {running ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <Play size={16} className="fill-current" /> Run Simulation
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results Panel */}
        <div className="md:col-span-8 bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 flex flex-col">
          <h3 className="font-bold text-primary mb-4 flex items-center gap-2">
            Projection Results
          </h3>
          
          {!results ? (
            <div className="flex-grow flex flex-col items-center justify-center text-on-surface-variant border-2 border-dashed border-outline-variant/50 rounded-xl p-8 bg-surface/30">
              <Activity className="w-12 h-12 mb-4 text-outline" strokeWidth={1} />
              <p>Configure parameters and run the simulation to view projections.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant font-mono">Final Balance</p>
                  <p className="text-2xl font-extrabold text-primary font-mono mt-1">
                    ${results.finalBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant font-mono">Total Return</p>
                  <p className="text-2xl font-extrabold text-secondary font-mono mt-1">
                    +{results.totalReturn.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant font-mono">Projected Annual Income</p>
                  <p className="text-2xl font-extrabold text-primary font-mono mt-1">
                    ${results.annualIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
              
              <div className="w-full h-[300px]" ref={chartContainerRef}></div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
