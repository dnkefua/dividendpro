import React, { useState } from "react";
import { AreaSeries, ColorType, createChart } from "lightweight-charts";
import { Stock, UserSettings, SavedStrategy } from "../types";
import { Activity, Play, Settings, DollarSign, Calendar, Save, Plus, ArrowRight, RefreshCw, BarChart3, Bookmark } from "lucide-react";
import { formatCurrency } from "../utils";

interface StudioViewProps {
  stocks: Stock[];
  settings: UserSettings;
  savedStrategies: SavedStrategy[];
  onSaveStrategy: (strategy: SavedStrategy) => void;
  onDeleteStrategy: (id: string) => void;
}

export default function StudioView({ stocks, settings, savedStrategies, onSaveStrategy, onDeleteStrategy }: StudioViewProps) {
  const [selectedSymbol, setSelectedSymbol] = useState(stocks[0]?.symbol || "");
  const [initialCapital, setInitialCapital] = useState<number>(settings.portfolioBudget);
  const [monthlyContribution, setMonthlyContribution] = useState<number>(500);
  const [years, setYears] = useState<number>(10);
  const [reinvestDividends, setReinvestDividends] = useState<boolean>(true);
  
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<any>(null);

  const chartContainerRef = React.useRef<HTMLDivElement>(null);
  const chartInstance = React.useRef<any>(null);

  const runSimulation = () => {
    if (!selectedSymbol) return;
    setRunning(true);
    setResults(null);
    
    setTimeout(() => {
      const stock = stocks.find(s => s.symbol === selectedSymbol);
      const yieldRate = (stock?.yield || 4) / 100;
      const cagr = 0.07; // 7% base capital appreciation
      
      let balance = initialCapital;
      const dataPoints = [];
      const currentDate = new Date();
      currentDate.setFullYear(currentDate.getFullYear() - years);

      for (let i = 0; i <= years; i++) {
        dataPoints.push({
          time: currentDate.toISOString().split("T")[0],
          value: Number(balance.toFixed(2))
        });
        
        // Add monthly contributions (annualized for simple simulation loop)
        balance += (monthlyContribution * 12);
        
        // Compound interest
        const dividendReturn = reinvestDividends ? (balance * yieldRate) : 0;
        const capitalReturn = balance * cagr;
        balance = balance + capitalReturn + dividendReturn;
        
        currentDate.setFullYear(currentDate.getFullYear() + 1);
      }

      setResults({
        finalBalance: balance,
        totalReturn: ((balance - initialCapital - (monthlyContribution * 12 * years)) / (initialCapital + (monthlyContribution * 12 * years))) * 100,
        annualIncome: balance * yieldRate,
        dataPoints
      });
      setRunning(false);
    }, 1000);
  };

  const handleSaveStrategy = () => {
    if (!results) return;
    const newStrategy: SavedStrategy = {
      id: crypto.randomUUID(),
      symbol: selectedSymbol,
      initialCapital,
      monthlyContribution,
      years,
      reinvestDividends,
      dateSaved: new Date().toISOString(),
      projectedValue: results.finalBalance
    };
    onSaveStrategy(newStrategy);
  };

  const loadStrategy = (strategy: SavedStrategy) => {
    setSelectedSymbol(strategy.symbol);
    setInitialCapital(strategy.initialCapital);
    setMonthlyContribution(strategy.monthlyContribution);
    setYears(strategy.years);
    setReinvestDividends(strategy.reinvestDividends);
    setResults(null);
    // Optionally auto-run here
  };

  React.useEffect(() => {
    if (results && chartContainerRef.current) {
      if (chartInstance.current) {
        chartInstance.current.chart.remove();
        chartInstance.current = null;
      }
      
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
      
      chartInstance.current.series.setData(results.dataPoints);
      chartInstance.current.chart.timeScale().fitContent();
    }
  }, [results]);

  return (
    <div className="space-y-8 animate-fade-in pb-16">
      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-primary flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-secondary" />
            Strategy Studio
          </h2>
          <p className="text-sm text-on-surface-variant mt-2 max-w-2xl">
            Investigate stocks, backtest dividend strategies, and save projections to track how they perform over time.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        
        {/* Configuration Panel */}
        <div className="md:col-span-3 bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 h-fit">
          <h3 className="font-bold text-primary mb-4 flex items-center gap-2 text-sm">
            <Settings size={16} /> Parameters
          </h3>
          
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1">Asset</label>
              <select 
                value={selectedSymbol}
                onChange={e => setSelectedSymbol(e.target.value)}
                className="w-full px-3 py-2 bg-surface border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm font-medium"
              >
                {stocks.map(s => <option key={s.symbol} value={s.symbol}>{s.name} ({s.symbol})</option>)}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1">Initial Capital</label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant" />
                <input 
                  type="number"
                  value={initialCapital}
                  onChange={e => setInitialCapital(Number(e.target.value))}
                  className="w-full pl-8 pr-3 py-2 bg-surface border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm font-bold"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1">Monthly Contribution</label>
              <div className="relative">
                <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant" />
                <input 
                  type="number"
                  value={monthlyContribution}
                  onChange={e => setMonthlyContribution(Number(e.target.value))}
                  className="w-full pl-8 pr-3 py-2 bg-surface border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm font-bold"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1">Time Horizon (Years)</label>
              <div className="relative">
                <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant" />
                <input 
                  type="number"
                  value={years}
                  onChange={e => setYears(Number(e.target.value))}
                  className="w-full pl-8 pr-3 py-2 bg-surface border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-sm font-bold"
                />
              </div>
            </div>

            <div className="flex items-center justify-between py-2 border-t border-outline-variant/50">
              <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">DRIP (Reinvest)</label>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={reinvestDividends}
                  onChange={e => setReinvestDividends(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-outline-variant peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-secondary"></div>
              </label>
            </div>

            <button 
              onClick={runSimulation}
              disabled={running}
              className="w-full mt-2 bg-primary text-on-primary hover:bg-opacity-90 px-4 py-2.5 rounded-lg font-bold text-sm shadow-sm transition-transform active:scale-95 flex items-center justify-center gap-2"
            >
              {running ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <Play size={14} className="fill-current" /> Run Simulation
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results Panel */}
        <div className="md:col-span-6 bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-primary flex items-center gap-2">
              Projection Results
            </h3>
            {results && (
              <button 
                onClick={handleSaveStrategy}
                className="flex items-center gap-1.5 text-xs font-bold text-secondary bg-secondary-container hover:bg-secondary/20 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Save size={14} /> Save Strategy
              </button>
            )}
          </div>
          
          {!results ? (
            <div className="flex-grow flex flex-col items-center justify-center text-on-surface-variant border-2 border-dashed border-outline-variant/50 rounded-xl p-8 bg-surface/30">
              <Activity className="w-12 h-12 mb-4 text-outline" strokeWidth={1} />
              <p className="text-sm text-center">Configure parameters and run the simulation to view projections.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant font-mono">Final Balance</p>
                  <p className="text-2xl font-extrabold font-mono text-secondary mt-1">
                    {formatCurrency(results.finalBalance, settings.currency, { maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant font-mono">Total Return</p>
                  <p className="text-xl font-extrabold text-secondary font-mono mt-1">
                    +{results.totalReturn.toFixed(1)}%
                  </p>
                </div>
                <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-on-surface-variant font-mono">Annual Income</p>
                  <p className="text-2xl font-extrabold font-mono text-primary mt-1">
                    {formatCurrency(results.annualIncome, settings.currency, { maximumFractionDigits: 0 })}
                  </p>
                </div>
              </div>
              
              <div className="w-full h-[300px]" ref={chartContainerRef}></div>
            </div>
          )}
        </div>

        {/* Saved Strategies Panel */}
        <div className="md:col-span-3 bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 h-fit max-h-[600px] overflow-y-auto">
          <h3 className="font-bold text-primary mb-4 flex items-center gap-2 text-sm">
            <Bookmark size={16} /> Saved Strategies
          </h3>
          
          {savedStrategies.length === 0 ? (
            <div className="text-center py-8 text-on-surface-variant text-sm">
              <Bookmark className="w-8 h-8 mx-auto mb-2 text-outline/50" />
              <p>No strategies saved yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {savedStrategies.map(strat => (
                <div 
                  key={strat.id} 
                  className="bg-surface border border-outline-variant rounded-xl p-3 hover:border-secondary transition-all cursor-pointer group"
                  onClick={() => loadStrategy(strat)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold font-mono text-primary bg-primary-container px-2 py-0.5 rounded text-xs">
                      {strat.symbol}
                    </span>
                    <span className="text-[10px] text-on-surface-variant font-mono">
                      {new Date(strat.dateSaved).toLocaleDateString()}
                    </span>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <p className="text-[9px] text-on-surface-variant uppercase tracking-wider font-bold">Capital</p>
                      <p className="text-xs font-mono font-bold text-primary">{formatCurrency(strat.initialCapital, settings.currency, { maximumFractionDigits: 0 })}</p>
                    </div>
                    <div>
                      <p className="text-[9px] text-on-surface-variant uppercase tracking-wider font-bold">Projected</p>
                      <p className="text-xs font-mono font-bold text-secondary">{formatCurrency(strat.projectedValue, settings.currency, { maximumFractionDigits: 0 })}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between border-t border-outline-variant/40 pt-2 mt-1">
                    <span className="text-[10px] text-on-surface-variant">
                      {strat.years}Y • {strat.monthlyContribution}/mo • {strat.reinvestDividends ? 'DRIP' : 'No DRIP'}
                    </span>
                    <button 
                      onClick={(e) => { e.stopPropagation(); onDeleteStrategy(strat.id); }}
                      className="text-[10px] font-bold text-error hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
