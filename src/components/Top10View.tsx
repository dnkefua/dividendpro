import React from "react";
import { Stock } from "../types";
import { 
  History, 
  ChevronRight, 
  TrendingUp, 
  Award, 
  ShieldAlert,
  HelpCircle,
  ArrowRight,
  Info
} from "lucide-react";

interface Top10ViewProps {
  stocks: Stock[];
  onSelectStock: (symbol: string) => void;
  isPro: boolean;
  onOpenAiAssistant: (prompt?: string) => void;
}

export default function Top10View({
  stocks,
  onSelectStock,
  isPro,
  onOpenAiAssistant
}: Top10ViewProps) {
  const [assetTab, setAssetTab] = React.useState<"All" | "Stock" | "Crypto font">("All");
  
  // Create sorted picks based on monthly frequency and active asset tab
  const topPicks = React.useMemo(() => {
    let list = stocks.filter(s => s.frequency === "Monthly");
    const activeTabNormalized = assetTab.startsWith("Crypto") ? "Crypto" : assetTab;
    if (activeTabNormalized !== "All") {
      list = list.filter(s => (s.assetType || "Stock") === activeTabNormalized);
    }
    
    // Sort specifically to have "O" or high yield at the top
    const sorted = [...list].sort((a, b) => {
      const aRank = parseInt(a.rank || "99");
      const bRank = parseInt(b.rank || "99");
      if (aRank !== bRank) return aRank - bRank;
      return b.yield - a.yield;
    });
    return sorted.slice(0, 10);
  }, [stocks, assetTab]);

  const stats = React.useMemo(() => {
    if (topPicks.length === 0) return { avgYield: 0, monthlyIncome: 0, avgSafety: 0 };
    const totalYield = topPicks.reduce((acc, curr) => acc + curr.yield, 0);
    const totalSafety = topPicks.reduce((acc, curr) => acc + curr.safetyScore, 0);
    const avgYield = totalYield / topPicks.length;
    const avgSafety = totalSafety / topPicks.length;
    // Estimated monthly income on $10,000 investment
    const monthlyIncome = (10000 * avgYield / 100) / 12;
    return { avgYield, monthlyIncome, avgSafety };
  }, [topPicks]);

  const featuredPick = topPicks[0];
  const otherPicks = topPicks.slice(1);

  return (
    <div className="space-y-8 animate-fade-in" id="top-10-view-container">
      {/* Hero Header Section */}
      <section className="mb-8" id="top-10-header">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-primary mb-2">
              Top 10 Monthly Income List
            </h1>
            <p className="text-on-surface-variant max-w-2xl text-sm md:text-base leading-relaxed">
              A curated selection of high-potential dividend stocks and crypto staking rewards characterized by reliable monthly payouts, strong balance sheets, and institutional safety.
            </p>
          </div>
          
          {/* Last Updated Badge */}
          <div className="flex items-center gap-3 bg-surface-container-low px-4 py-3 rounded-xl border border-outline-variant shadow-xs">
            <History className="w-5 h-5 text-secondary" />
            <div>
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
          <p className="text-xs text-slate-300">Compounded monthly payouts</p>
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

      {/* Asset Tab Filters */}
      <div className="flex gap-2 p-1.5 bg-surface-container-low rounded-2xl w-fit border border-outline-variant/50" id="top10-asset-tabs">
        {[
          { id: "All", label: "All Monthly Assets" },
          { id: "Stock", label: "Monthly Stocks Only" },
          { id: "Crypto", label: "Crypto Yields Only" }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setAssetTab(tab.id as any)}
            className={`px-5 py-2 text-xs font-extrabold rounded-xl transition-all cursor-pointer ${
              (assetTab.startsWith("Crypto") && tab.id === "Crypto") || assetTab === tab.id
                ? "bg-white text-primary shadow-xs border border-outline-variant/40"
                : "text-on-surface-variant hover:text-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Ranking List */}
      <section className="space-y-6" id="ranking-list">
        
        {/* Rank #1 - Featured Bento Card */}
        {featuredPick ? (
          <div 
            onClick={() => onSelectStock(featuredPick.symbol)}
            className="grid grid-cols-1 md:grid-cols-12 bg-white border border-outline-variant rounded-2xl overflow-hidden group hover:border-secondary transition-all duration-300 shadow-sm hover:shadow-md cursor-pointer"
            id="featured-rank-card"
          >
            {/* Gradient Ribbon */}
            <div className="col-span-12 md:col-span-1 bg-gradient-to-br from-primary-container to-black flex items-center justify-center text-white py-6 md:py-0">
              <span className="text-4xl font-extrabold font-mono tracking-tight text-secondary-container">01</span>
            </div>

            {/* Left Body Details */}
            <div className="col-span-12 md:col-span-7 p-6 md:p-8 space-y-4">
              <div className="flex items-center gap-3">
                <h2 className="text-xl md:text-2xl font-bold text-primary flex items-center gap-2">
                  {featuredPick.name} ({featuredPick.symbol})
                  <span className="text-sm">{(featuredPick.assetType || "Stock") === "Crypto" ? "🪙" : "💼"}</span>
                </h2>
                <span className="bg-secondary-container text-on-secondary-container px-3 py-0.5 rounded-full text-xs font-mono font-bold uppercase tracking-wider">
                  {featuredPick.sector === "Real Estate" ? "REITs" : featuredPick.sector}
                </span>
              </div>
              <p className="text-sm text-on-surface-variant leading-relaxed">
                {featuredPick.whyPick}
              </p>
              
              <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pt-2">
                <div>
                  <p className="text-[10px] font-bold font-mono text-outline uppercase tracking-wider">Annual Yield</p>
                  <p className="text-lg font-bold text-secondary font-mono">{featuredPick.yield.toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold font-mono text-outline uppercase tracking-wider">Monthly Payout</p>
                  <p className="text-lg font-bold text-primary font-mono">${(featuredPick.price * featuredPick.yield / 100 / 12).toFixed(3)}</p>
                </div>
                <div className="hidden md:block">
                  <p className="text-[10px] font-bold font-mono text-outline uppercase tracking-wider">
                    {(featuredPick.assetType || "Stock") === "Crypto" ? "Locking Period" : "P/E Ratio"}
                  </p>
                  <p className="text-lg font-bold text-primary font-mono">{featuredPick.pAffo}</p>
                </div>
              </div>
            </div>

            {/* Right Summary Rationale */}
            <div className="col-span-12 md:col-span-4 bg-surface-container-low/60 p-6 md:p-8 flex flex-col justify-center border-t md:border-t-0 md:border-l border-outline-variant/60">
              <h4 className="text-xs font-bold text-primary font-mono uppercase tracking-wider mb-2">Why it's a pick</h4>
              <p className="text-sm text-on-surface-variant italic leading-relaxed">
                "{featuredPick.whyPick}"
              </p>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectStock(featuredPick.symbol);
                }}
                className="mt-4 inline-flex items-center gap-1.5 text-secondary hover:underline text-xs font-bold font-mono uppercase tracking-wider"
              >
                View Analysis 
                <TrendingUp className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-12 bg-white border border-outline-variant rounded-2xl text-on-surface-variant font-medium">
            No recommended monthly assets found in this category.
          </div>
        )}

        {/* Rank #2-10 - Streamlined Cards */}
        <div className="grid grid-cols-1 gap-3" id="streamlined-ranks-container">
          {otherPicks.map((stock, idx) => (
            <div 
              key={stock.symbol}
              onClick={() => onSelectStock(stock.symbol)}
              className="flex flex-col md:flex-row items-stretch bg-white border border-outline-variant rounded-xl overflow-hidden hover:shadow-sm hover:border-outline-variant/80 transition-all duration-200 cursor-pointer"
            >
              {/* Rank Block */}
              <div className="w-full md:w-16 bg-surface-container-high/40 flex items-center justify-center font-mono font-extrabold text-lg text-outline py-2.5 md:py-0 border-b md:border-b-0 md:border-r border-outline-variant/60">
                {stock.rank || `0${idx + 2}`}
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
          ))}
        </div>

      </section>

      {/* Call to Action Upgrade Pro Footer Area */}
      <section className="mt-12" id="top-10-newsletter-card">
        <div className="relative overflow-hidden bg-primary-container rounded-2xl p-8 text-white flex flex-col md:flex-row items-center justify-between gap-6 border border-outline-variant/10 shadow-lg">
          <div className="relative z-10 space-y-1">
            <h3 className="text-2xl font-bold">Unlock Pro Research Insights</h3>
            <p className="text-sm text-on-primary-container/80 max-w-md">
              Get the full institutional analysis on these top 10 picks plus 50+ secondary monthly compounding stock reports.
            </p>
          </div>
          
          <div className="relative z-10 flex gap-3 w-full md:w-auto shrink-0">
            <button className="flex-grow md:flex-none bg-secondary hover:bg-opacity-95 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-sm transition-transform active:scale-95">
              Upgrade to Pro
            </button>
            <button 
              onClick={() => onOpenAiAssistant("Please provide a comparative summary of the Top 10 High Yield stocks, highlight which has the highest dividend safety score and growth rate, and why.")}
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
    </div>
  );
}
