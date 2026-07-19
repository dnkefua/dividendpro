import React, { useState } from "react";
import { Stock } from "../types";
import { getAssetColor } from "../utils";
import { 
  History, 
  ChevronRight, 
  TrendingUp, 
  Award, 
  Info,
  Plus
} from "lucide-react";

interface Top10ViewProps {
  stocks: Stock[];
  onSelectStock: (symbol: string) => void;
  isPro: boolean;
  onOpenAiAssistant: (prompt?: string) => void;
  onAddCustomStock: (stock: Omit<Stock, "id">) => void;
}

export default function Top10View({
  stocks,
  onSelectStock,
  isPro,
  onOpenAiAssistant,
  onAddCustomStock
}: Top10ViewProps) {
  const [freqTab, setFreqTab] = React.useState<string>("Monthly");
  
  // Create sorted picks for Stocks
  const topStocks = React.useMemo(() => {
    let list = stocks.filter(s => (s.assetType || "Stock") !== "Crypto");
    if (freqTab !== "All") {
      const targetFreq = freqTab === "Yearly" ? "Annual" : freqTab;
      list = list.filter(s => s.frequency === targetFreq);
    }
    return [...list].sort((a, b) => b.yield - a.yield).slice(0, 10);
  }, [stocks, freqTab]);

  // Create sorted picks for Crypto
  const topCrypto = React.useMemo(() => {
    let list = stocks.filter(s => (s.assetType || "Stock") === "Crypto");
    if (freqTab !== "All") {
      const targetFreq = freqTab === "Yearly" ? "Annual" : freqTab;
      list = list.filter(s => s.frequency === targetFreq);
    }
    return [...list].sort((a, b) => b.yield - a.yield).slice(0, 10);
  }, [stocks, freqTab]);

  const stats = React.useMemo(() => {
    const combined = [...topStocks.slice(0, 5), ...topCrypto.slice(0, 5)];
    if (combined.length === 0) return { avgYield: 0, monthlyIncome: 0, avgSafety: 0 };
    const totalYield = combined.reduce((acc, curr) => acc + curr.yield, 0);
    const totalSafety = combined.reduce((acc, curr) => acc + curr.safetyScore, 0);
    const avgYield = totalYield / combined.length;
    const avgSafety = totalSafety / combined.length;
    // Estimated monthly income on $10,000 investment
    const monthlyIncome = (10000 * avgYield / 100) / 12;
    return { avgYield, monthlyIncome, avgSafety };
  }, [topStocks, topCrypto]);

  // Modal State
  const [showAddCustomModal, setShowAddCustomModal] = useState(false);
  const [customStock, setCustomStock] = useState({
    symbol: "",
    name: "",
    sector: "Technology",
    price: 100,
    yield: 4.5,
    growth5y: 5.0,
    payoutRatio: 55,
    frequency: "Quarterly" as "Monthly" | "Quarterly" | "Annual",
    whyPick: "High solid yield backed by standard defensive operations.",
    assetType: "Stock" as "Stock" | "Crypto"
  });

  const handleCreateCustomStock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customStock.symbol) return;
    
    const newStock: Stock = {
      symbol: customStock.symbol.toUpperCase(),
      name: customStock.name || customStock.symbol.toUpperCase() + (customStock.assetType === "Crypto" ? "" : " Inc."),
      sector: customStock.sector,
      price: Number(customStock.price),
      yield: Number(customStock.yield),
      growth5y: Number(customStock.growth5y),
      payoutRatio: Number(customStock.payoutRatio),
      frequency: customStock.frequency,
      historySparkline: [20, 40, 50, 70, 85, 100],
      marketCap: customStock.assetType === "Crypto" ? "2.4B" : "5.5B",
      pAffo: customStock.assetType === "Crypto" ? "N/A" : "14.5x",
      exDivDate: "Nov 15, 2024",
      payDate: "Dec 15, 2024",
      divType: customStock.assetType === "Crypto" ? "Staking Reward" : "Qualified",
      safetyScore: 75,
      safetyLabel: "Safe",
      whyPick: customStock.whyPick,
      assetType: customStock.assetType,
      dividendGrowthHistory: [
        { year: 2021, payout: 1.60 },
        { year: 2022, payout: 1.80 },
        { year: 2023, payout: 2.05 }
      ]
    };

    onAddCustomStock(newStock);
    setShowAddCustomModal(false);
    onSelectStock(newStock.symbol);
  };

  const renderAssetCard = (stock: Stock, idx: number) => (
    <div 
      key={stock.symbol}
      onClick={() => onSelectStock(stock.symbol)}
      className="flex flex-col md:flex-row items-stretch bg-white border border-outline-variant rounded-xl overflow-hidden hover:shadow-sm hover:border-outline-variant/80 transition-all duration-200 cursor-pointer"
    >
      {/* Rank Block */}
      <div 
        className="w-full md:w-16 flex items-center justify-center font-mono font-extrabold text-lg text-white py-2.5 md:py-0 border-b md:border-b-0 md:border-r border-outline-variant/60 shadow-inner"
        style={{ backgroundColor: getAssetColor(stock.symbol) }}
      >
        {stock.rank || `0${idx + 1}`}
      </div>

      {/* Body */}
      <div className="flex-grow p-4 md:p-5 flex flex-col md:flex-row items-center gap-4">
        {/* Name */}
        <div className="w-full md:w-1/3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-bold text-primary group-hover:text-secondary transition-colors text-base leading-tight flex items-center gap-1">
              {stock.name}
              <span>{(stock.assetType || "Stock") === "Crypto" ? "🪙" : "💼"}</span>
            </h3>
            <span className="text-outline font-mono text-xs font-semibold">({stock.symbol})</span>
          </div>
          <p className="text-[10px] font-bold text-outline font-mono uppercase tracking-wider mt-1">{stock.sector}</p>
        </div>

        {/* Performance stats */}
        <div className="w-full md:w-1/4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-[10px] font-bold text-outline font-mono uppercase tracking-wider">Yield</p>
            <p className="text-sm font-bold text-secondary font-mono">{stock.yield.toFixed(2)}%</p>
          </div>
          <div>
            <p className="text-[10px] font-bold text-outline font-mono uppercase tracking-wider">Payout</p>
            <p className="text-sm font-bold text-primary font-mono">
              ${(stock.price * stock.yield / 100 / 12).toFixed(2)}
            </p>
          </div>
        </div>

        {/* Pick Why snippet */}
        <div className="w-full md:w-5/12 bg-surface-container-lowest rounded-lg p-2 md:p-3 border border-outline-variant/30 flex items-start gap-2">
          <Info className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
          <p className="text-xs text-on-surface-variant leading-relaxed line-clamp-2 md:line-clamp-1">
            <span className="font-bold text-primary mr-1 text-[10px] font-mono uppercase tracking-wider">RATIONALE:</span> 
            {stock.whyPick}
          </p>
        </div>

        {/* Chevron */}
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onSelectStock(stock.symbol);
          }}
          className="w-full md:w-auto p-2 rounded-full hover:bg-surface-container-low transition-colors self-end md:self-center"
        >
          <ChevronRight className="w-5 h-5 text-outline group-hover:text-primary transition-colors" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-8 animate-fade-in" id="top-10-view-container">
      {/* Hero Header Section */}
      <section className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-6" id="top-10-header">
        <div>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-primary mb-2">
            Top 10 {freqTab === "All" ? "Yielding" : freqTab} Picks
          </h1>
          <p className="text-on-surface-variant max-w-2xl text-sm md:text-base leading-relaxed">
            A curated selection of high-potential dividend stocks and crypto staking rewards characterized by reliable payouts, strong balance sheets, and institutional safety.
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Add Custom Asset Button */}
          <button 
            onClick={() => setShowAddCustomModal(true)}
            className="flex items-center gap-2 bg-secondary text-white hover:bg-opacity-90 px-5 py-3 rounded-xl font-bold text-sm shadow-sm transition-transform active:scale-95 whitespace-nowrap"
          >
            <Plus className="w-5 h-5" />
            Add Asset
          </button>
          {/* Last Updated Badge */}
          <div className="flex items-center gap-3 bg-surface-container-low px-4 py-3 rounded-xl border border-outline-variant shadow-xs">
            <History className="w-5 h-5 text-secondary" />
            <div className="hidden sm:block">
              <p className="text-[10px] font-bold font-mono text-outline uppercase tracking-wider leading-none">Last Updated</p>
              <p className="text-xs font-bold text-primary font-mono mt-1">July 17, 2026</p>
            </div>
          </div>
        </div>
      </section>

      {/* Potential Profits Calculator Bento Card */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-5 bg-gradient-to-br from-primary to-primary-container text-white p-6 rounded-2xl border border-outline-variant/10 shadow-md animate-fade-in" id="top-10-profits-card">
        <div className="space-y-1">
          <p className="text-[10px] font-bold font-mono text-secondary-container uppercase tracking-wider">Average Annual Yield</p>
          <p className="text-3xl font-extrabold font-mono text-secondary">{stats.avgYield.toFixed(2)}%</p>
          <p className="text-xs text-slate-300">Top 5 Picks (Combined)</p>
        </div>
        <div className="space-y-1 border-t sm:border-t-0 sm:border-l border-slate-700/50 pt-4 sm:pt-0 sm:pl-6">
          <p className="text-[10px] font-bold font-mono text-secondary-container uppercase tracking-wider">Monthly Profit on $10k</p>
          <p className="text-3xl font-extrabold font-mono text-white">${stats.monthlyIncome.toFixed(2)}</p>
          <p className="text-xs text-slate-300">Passive yield generation</p>
        </div>
        <div className="space-y-1 border-t sm:border-t-0 sm:border-l border-slate-700/50 pt-4 sm:pt-0 sm:pl-6">
          <p className="text-[10px] font-bold font-mono text-secondary-container uppercase tracking-wider">Average Safety Grade</p>
          <p className="text-3xl font-extrabold font-mono text-white">{stats.avgSafety.toFixed(0)}/100</p>
          <p className="text-xs text-slate-300">
            {stats.avgSafety >= 80 ? "🛡️ Institutional Safe" : stats.avgSafety >= 60 ? "🛡️ Moderate Risk" : "⚠️ High Volatility"}
          </p>
        </div>
      </section>

      {/* Filters Container */}
      <div className="flex items-center justify-end w-full">
        <div className="flex items-center gap-3 bg-surface-container-low p-2 rounded-2xl border border-outline-variant/50">
          <span className="text-[10px] font-bold font-mono text-outline uppercase tracking-wider ml-2 hidden sm:block">Payout Frequency:</span>
          <select 
            value={freqTab}
            onChange={(e) => setFreqTab(e.target.value)}
            className="px-4 py-2 bg-white border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-sm font-bold text-primary shadow-sm appearance-none cursor-pointer min-w-[140px]"
          >
            <option value="All">All Frequencies</option>
            <option value="Continuous">Continuous (Crypto)</option>
            <option value="Weekly">Weekly</option>
            <option value="Monthly">Monthly</option>
            <option value="Quarterly">Quarterly</option>
            <option value="Yearly">Yearly</option>
          </select>
        </div>
      </div>

      {/* Dual Ranking Lists */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {/* Stocks List */}
        <section className="space-y-4">
          <h2 className="text-2xl font-extrabold text-primary flex items-center gap-2">
            💼 Top 10 Stocks
          </h2>
          <div className="grid grid-cols-1 gap-3">
            {topStocks.length > 0 ? (
              topStocks.map((stock, idx) => renderAssetCard(stock, idx))
            ) : (
              <div className="text-center py-12 bg-white border border-outline-variant rounded-2xl text-on-surface-variant font-medium">
                No recommended stocks found for this frequency.
              </div>
            )}
          </div>
        </section>

        {/* Crypto List */}
        <section className="space-y-4">
          <h2 className="text-2xl font-extrabold text-primary flex items-center gap-2">
            🪙 Top 10 Crypto Yields
          </h2>
          <div className="grid grid-cols-1 gap-3">
            {topCrypto.length > 0 ? (
              topCrypto.map((stock, idx) => renderAssetCard(stock, idx))
            ) : (
              <div className="text-center py-12 bg-white border border-outline-variant rounded-2xl text-on-surface-variant font-medium">
                No recommended crypto yields found for this frequency.
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Call to Action Upgrade Pro Footer Area */}
      <section className="mt-12" id="top-10-newsletter-card">
        <div className="relative overflow-hidden bg-primary-container rounded-2xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 border border-outline-variant/10 shadow-lg">
          <div className="relative z-10 space-y-1">
            <h3 className="text-2xl font-bold">Unlock Pro Research Insights</h3>
            <p className="text-sm text-on-primary-container/80 max-w-md">
              Get the full institutional analysis on these top 10 picks plus 50+ secondary high-yield compounding reports.
            </p>
          </div>
          
          <div className="relative z-10 flex gap-3 w-full flex-col sm:flex-row md:w-auto shrink-0">
            <button className="flex-grow md:flex-none bg-secondary hover:bg-opacity-95 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-sm transition-transform active:scale-95">
              Upgrade to Pro
            </button>
            <button 
              onClick={() => onOpenAiAssistant("Please provide a comparative summary of the Top 10 High Yield assets, highlight which has the highest dividend safety score and growth rate, and why.")}
              className="flex-grow md:flex-none border border-outline-variant text-white px-6 py-3 hover:bg-white/10 rounded-xl font-bold text-sm transition-colors active:scale-95"
            >
              Analyze List with AI
            </button>
          </div>
          
          {/* Subtle design flare */}
          <div className="absolute right-0 bottom-0 opacity-15 pointer-events-none">
            <Award className="w-64 h-64 text-secondary-container transform translate-x-12 translate-y-12" />
          </div>
        </div>
      </section>

      {/* Add Custom Stock Modal */}
      {showAddCustomModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-fade-in">
          <div className="bg-white border border-outline-variant rounded-2xl max-w-md w-full p-6 shadow-xl relative animate-scale-up max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-primary mb-2">Add Asset to Top 10 Database</h3>
            <p className="text-sm text-on-surface-variant mb-6">Create a new asset. If the yield is competitive, it will automatically rank in the Top 10 lists!</p>
            
            <form onSubmit={handleCreateCustomStock} className="space-y-4">
              {/* Asset Type Selector */}
              <div>
                <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1.5">Asset Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setCustomStock(prev => ({ ...prev, assetType: "Stock", sector: "Technology" }))}
                    className={`py-2 rounded-lg font-bold text-xs border transition-all cursor-pointer ${
                      customStock.assetType === "Stock"
                        ? "bg-primary text-on-primary border-primary font-extrabold"
                        : "bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-container font-bold"
                    }`}
                  >
                    Stock
                  </button>
                  <button
                    type="button"
                    onClick={() => setCustomStock(prev => ({ ...prev, assetType: "Crypto", sector: "Crypto Staking" }))}
                    className={`py-2 rounded-lg font-bold text-xs border transition-all cursor-pointer ${
                      customStock.assetType === "Crypto"
                        ? "bg-primary text-on-primary border-primary font-extrabold"
                        : "bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-container font-bold"
                    }`}
                  >
                    Crypto
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Symbol (Ticker)*</label>
                  <input
                    type="text"
                    required
                    placeholder={customStock.assetType === "Crypto" ? "e.g. ETH" : "e.g. SCHD"}
                    value={customStock.symbol}
                    onChange={(e) => setCustomStock(prev => ({ ...prev, symbol: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none uppercase font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Name</label>
                  <input
                    type="text"
                    placeholder={customStock.assetType === "Crypto" ? "Ethereum Staking" : "Schwab Dividend"}
                    value={customStock.name}
                    onChange={(e) => setCustomStock(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Sector</label>
                  <select
                    value={customStock.sector}
                    onChange={(e) => setCustomStock(prev => ({ ...prev, sector: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none text-primary"
                  >
                    {customStock.assetType === "Crypto" ? (
                      <>
                        <option value="Crypto Staking">Crypto Staking</option>
                        <option value="Stablecoins">Stablecoins</option>
                        <option value="DeFi Lending">DeFi Lending</option>
                      </>
                    ) : (
                      <>
                        <option value="Technology">Technology</option>
                        <option value="Financials">Financials</option>
                        <option value="Real Estate">Real Estate</option>
                        <option value="Consumer Staples">Consumer Staples</option>
                        <option value="Healthcare">Healthcare</option>
                        <option value="Energy">Energy</option>
                        <option value="Utilities">Utilities</option>
                      </>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Frequency</label>
                  <select
                    value={customStock.frequency}
                    onChange={(e) => setCustomStock(prev => ({ ...prev, frequency: e.target.value as any }))}
                    className="w-full px-4 py-2.5 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none text-primary"
                  >
                    <option value="Continuous">Continuous (Crypto)</option>
                    <option value="Weekly">Weekly</option>
                    <option value="Monthly">Monthly</option>
                    <option value="Quarterly">Quarterly</option>
                    <option value="Annual">Annual</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Price ($)</label>
                  <input
                    type="number"
                    min="0.000001"
                    step="0.000001"
                    value={customStock.price}
                    onChange={(e) => setCustomStock(prev => ({ ...prev, price: Number(e.target.value) }))}
                    className="w-full px-4 py-2.5 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Yield (%)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customStock.yield}
                    onChange={(e) => setCustomStock(prev => ({ ...prev, yield: Number(e.target.value) }))}
                    className="w-full px-4 py-2.5 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1">
                    {customStock.assetType === "Crypto" ? "Inflation %" : "Payout Ratio %"}
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="200"
                    value={customStock.payoutRatio}
                    onChange={(e) => setCustomStock(prev => ({ ...prev, payoutRatio: Number(e.target.value) }))}
                    className="w-full px-4 py-2.5 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Pick Rationale</label>
                <textarea
                  value={customStock.whyPick}
                  onChange={(e) => setCustomStock(prev => ({ ...prev, whyPick: e.target.value }))}
                  className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none h-16"
                  placeholder={customStock.assetType === "Crypto" ? "Why is this staking pool a good option?" : "Why is this stock a good option?"}
                />
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-outline-variant">
                <button
                  type="button"
                  onClick={() => setShowAddCustomModal(false)}
                  className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-bold bg-primary text-on-primary hover:bg-opacity-90 rounded-lg transition-transform active:scale-95 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Add Asset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
