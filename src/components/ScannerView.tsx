import React, { useState, useMemo, useEffect } from "react";
import { Stock } from "../types";
import { getAssetColor } from "../utils";
import { 
  Search, 
  ChevronRight, 
  TrendingUp, 
  SlidersHorizontal, 
  HelpCircle,
  Star,
  Plus,
  BookOpen,
  ArrowRight,
  Filter
} from "lucide-react";
import { UserSettings } from "../types";
import { formatCurrency } from "../utils";

interface ScannerViewProps {
  stocks: Stock[];
  onSelectStock: (symbol: string) => void;
  isPro: boolean;
  onOpenAiAssistant: (prompt?: string) => void;
  onAddCustomStock: (stock: Stock) => void;
  settings: UserSettings;
}

export default function ScannerView({
  stocks,
  onSelectStock,
  isPro,
  onOpenAiAssistant,
  onAddCustomStock,
  settings
}: ScannerViewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [minYield, setMinYield] = useState("Any");
  const [selectedSector, setSelectedSector] = useState("All Sectors");
  const [selectedFreq, setSelectedFreq] = useState("All");
  const [selectedCountry, setSelectedCountry] = useState("All");
  const [selectedExchange, setSelectedExchange] = useState("All");
  const [assetTypeFilter, setAssetTypeFilter] = useState<"All" | "Stock" | "Crypto">("All");

  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Debounce search effect to fetch real-world matches from backend API
  useEffect(() => {
    // If no search term and no specific frequency, clear results
    if ((!searchTerm || searchTerm.trim().length < 2) && selectedFreq === "All") {
      setSearchResults([]);
      return;
    }

    const type = assetTypeFilter === "All" ? "Stock" : assetTypeFilter;
    const delayDebounce = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/assets/search?q=${encodeURIComponent(searchTerm)}&type=${type}&country=${selectedCountry}&frequency=${selectedFreq}`
        );
        if (response.ok) {
          const data = await response.json();
          setSearchResults(data.quotes || []);
        }
      } catch (e) {
        console.error("Live search failed:", e);
      } finally {
        setIsSearching(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [searchTerm, assetTypeFilter, selectedCountry, selectedExchange, selectedFreq]);

  const handleSelectLiveAsset = async (symbol: string) => {
    try {
      setSearchTerm("");
      setSearchResults([]);

      const response = await fetch(`/api/assets/quote?symbol=${encodeURIComponent(symbol)}`);
      if (response.ok) {
        const data = await response.json();
        
        // Add to parent stock list if it doesn't already exist
        if (!stocks.some(s => s.symbol.toUpperCase() === symbol.toUpperCase())) {
          onAddCustomStock(data);
        }
        
        // Navigate user straight to the Analysis View for this real asset
        onSelectStock(data.symbol);
      }
    } catch (e) {
      console.error("Failed to load live asset quote:", e);
    }
  };

  // Form state for creating a custom stock
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

  const sectors = useMemo(() => {
    const relevantStocks = assetTypeFilter === "All" 
      ? stocks 
      : stocks.filter(s => (s.assetType || "Stock") === assetTypeFilter);
    const list = new Set(relevantStocks.map(s => s.sector));
    return ["All Sectors", ...Array.from(list)];
  }, [stocks, assetTypeFilter]);

  const filteredStocks = useMemo(() => {
    return stocks.filter(s => {
      const matchesAssetType = assetTypeFilter === "All" || (s.assetType || "Stock") === assetTypeFilter;
      
      const matchSearch = s.symbol.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          s.name.toLowerCase().includes(searchTerm.toLowerCase());
      
      let matchYield = true;
      if (minYield === "2%+") matchYield = s.yield >= 2;
      else if (minYield === "4%+") matchYield = s.yield >= 4;
      else if (minYield === "6%+") matchYield = s.yield >= 6;

      const matchSector = selectedSector === "All Sectors" || s.sector === selectedSector;
      const matchFreq = selectedFreq === "All" || selectedFreq === "Any" || s.frequency === selectedFreq;
      
      const sCountry = s.country || (s.assetType === "Crypto" ? "Global" : "US");
      const matchCountry = selectedCountry === "All" || sCountry === selectedCountry;

      const sExchange = s.exchange || (s.assetType === "Crypto" ? "Crypto" : "NYSE");
      const matchExchange = selectedExchange === "All" || sExchange === selectedExchange;

      return matchesAssetType && matchSearch && matchYield && matchSector && matchFreq && matchCountry && matchExchange;
    });
  }, [stocks, searchTerm, minYield, selectedSector, selectedFreq, assetTypeFilter, selectedCountry, selectedExchange]);

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
    // Automatically view the newly created stock!
    onSelectStock(newStock.symbol);
  };

  return (
    <div className="space-y-8 animate-fade-in" id="scanner-view-container">
      {/* Title Header Section */}
      <section className="mt-2" id="scanner-header">
        <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-primary mb-2">
          Dividend Scanner
        </h1>
        <p className="text-on-surface-variant max-w-2xl text-sm md:text-base leading-relaxed">
          Find your next income powerhouse. Filter through global assets based on high-precision metrics, payout safety, and multi-year track records.
        </p>
      </section>

      {/* Asset Type Selector Tabs */}
      <div className="flex gap-2 p-1.5 bg-surface-container-low rounded-2xl w-fit border border-outline-variant/50" id="scanner-asset-type-tabs">
        {[
          { id: "All", label: "All Assets" },
          { id: "Stock", label: "Stocks Only" },
          { id: "Crypto", label: "Crypto Yields" }
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setAssetTypeFilter(tab.id as any);
              setSelectedSector("All Sectors");
            }}
            className={`px-5 py-2 text-xs font-extrabold rounded-xl transition-all cursor-pointer ${
              assetTypeFilter === tab.id
                ? "bg-white text-primary shadow-xs border border-outline-variant/40"
                : "text-on-surface-variant hover:text-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter Bento Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-5 items-end bg-surface-container-low/40 p-4 md:p-6 rounded-2xl border border-outline-variant/50" id="scanner-filter-bar">
        
        {/* Search Input */}
        {/* Search Input */}
        <div className="md:col-span-3 space-y-2 relative">
          <label className="text-[10px] font-bold font-mono text-on-surface-variant uppercase tracking-wider block">Search / Explore</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline" />
            <input 
              type="text" 
              placeholder="e.g. AAPL, O..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-12 py-3 bg-white border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-sm transition-all shadow-sm font-medium text-primary"
            />
            {isSearching && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
                <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
              </div>
            )}
          </div>

          {/* Live Search Suggestions Dropdown */}
          {searchResults.length > 0 && (
            <div className="absolute left-0 right-0 mt-2 bg-white border border-outline-variant rounded-xl shadow-2xl z-50 overflow-hidden max-h-60 overflow-y-auto">
              {searchResults.map((res: any) => (
                <button
                  key={res.symbol}
                  onClick={() => handleSelectLiveAsset(res.symbol)}
                  className="w-full text-left px-4 py-3 hover:bg-surface-container-lowest transition-colors border-b border-outline-variant/30 last:border-b-0 flex justify-between items-center"
                >
                  <div className="min-w-0 pr-2">
                    <span className="text-sm font-bold text-primary mr-2 block sm:inline">{res.symbol}</span>
                    <span className="text-xs text-on-surface-variant truncate block sm:inline">{res.name}</span>
                  </div>
                  <span className="text-[10px] bg-secondary-container text-on-secondary-container px-2 py-0.5 rounded-full font-bold uppercase font-mono shrink-0">
                    {res.exchange || (res.quoteType === "CRYPTOCURRENCY" || res.symbol?.includes("-USD") ? "Crypto" : "Stock")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Country Filter */}
        {assetTypeFilter !== "Crypto" ? (
          <div className="md:col-span-2 space-y-2">
            <label className="text-[10px] font-bold font-mono text-on-surface-variant uppercase tracking-wider block">Country</label>
            <select 
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-sm font-medium transition-all shadow-sm text-primary appearance-none"
            >
              <option value="All">Global</option>
              <option value="US">USA</option>
              <option value="UK">UK</option>
              <option value="CA">Canada</option>
              <option value="AU">Australia</option>
              <option value="FR">France</option>
            </select>
          </div>
        ) : (
          <div className="md:col-span-2 space-y-2 hidden md:block"></div>
        )}

        {/* Exchange Filter */}
        {assetTypeFilter !== "Crypto" ? (
          <div className="md:col-span-2 space-y-2">
            <label className="text-[10px] font-bold font-mono text-on-surface-variant uppercase tracking-wider block">Exchange</label>
            <select 
              value={selectedExchange}
              onChange={(e) => setSelectedExchange(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-sm font-medium transition-all shadow-sm text-primary appearance-none"
            >
              <option value="All">All</option>
              <option value="NYSE">NYSE</option>
              <option value="NASDAQ">NASDAQ</option>
              <option value="LSE">LSE</option>
              <option value="TSX">TSX</option>
              <option value="ASX">ASX</option>
              <option value="Euronext">Euronext</option>
            </select>
          </div>
        ) : null}

        {/* Min Yield */}
        <div className="md:col-span-2 space-y-2">
          <label className="text-[10px] font-bold font-mono text-on-surface-variant uppercase tracking-wider block">Min Yield %</label>
          <select 
            value={minYield}
            onChange={(e) => setMinYield(e.target.value)}
            className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-sm font-medium transition-all shadow-sm text-primary appearance-none"
          >
            <option value="Any">Any</option>
            <option value="2%+">2%+</option>
            <option value="4%+">4%+</option>
            <option value="6%+">6%+</option>
          </select>
        </div>

        {/* Sector Filter */}
        <div className="md:col-span-2 space-y-2">
          <label className="text-[10px] font-bold font-mono text-on-surface-variant uppercase tracking-wider block">Sector</label>
          <select 
            value={selectedSector}
            onChange={(e) => setSelectedSector(e.target.value)}
            className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-sm font-medium transition-all shadow-sm text-primary appearance-none"
          >
            {sectors.map(sec => (
              <option key={sec} value={sec}>{sec}</option>
            ))}
          </select>
        </div>

        {/* Frequency Filter */}
        <div className="md:col-span-2 space-y-2">
          <label className="text-[10px] font-bold font-mono text-on-surface-variant uppercase tracking-wider block">Frequency</label>
          <select 
            value={selectedFreq}
            onChange={(e) => setSelectedFreq(e.target.value)}
            className="w-full px-4 py-3 bg-white border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary text-sm font-medium transition-all shadow-sm text-primary appearance-none"
          >
            <option value="All">All</option>
            {assetTypeFilter === "Crypto" ? (
              <>
                <option value="Continuous">Continuous</option>
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
              </>
            ) : (
              <>
                <option value="Monthly">Monthly</option>
                <option value="Quarterly">Quarterly</option>
                <option value="Yearly">Yearly</option>
              </>
            )}
          </select>
        </div>

        {/* Apply filter button action */}
        <div className="md:col-span-1">
          <button 
            id="btn-filter-trigger"
            className="w-full flex items-center justify-center bg-primary text-on-primary hover:bg-opacity-90 py-3.5 rounded-xl transition-all shadow-sm active:scale-95"
            onClick={() => {
              // Trigger simple confirmation alert, or filter is live!
            }}
            title="Filter options are live updated"
          >
            <Filter className="w-5 h-5" />
          </button>
        </div>

      </div>

      {/* Results Table Card */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-hidden shadow-sm" id="scanner-table-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container-low border-b border-outline-variant">
              <tr>
                <th className="px-6 py-4 text-xs font-bold font-mono text-on-surface-variant uppercase tracking-wider">Asset</th>
                <th className="px-6 py-4 text-xs font-bold font-mono text-on-surface-variant uppercase tracking-wider">Price</th>
                <th className="px-6 py-4 text-xs font-bold font-mono text-on-surface-variant uppercase tracking-wider">Yield</th>
                <th className="px-6 py-4 text-xs font-bold font-mono text-on-surface-variant uppercase tracking-wider">Growth (5Y)</th>
                <th className="px-6 py-4 text-xs font-bold font-mono text-on-surface-variant uppercase tracking-wider">Payout Ratio</th>
                <th className="px-6 py-4 text-xs font-bold font-mono text-on-surface-variant uppercase tracking-wider">History</th>
                <th className="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {filteredStocks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-on-surface-variant">
                    No equities found matching the specified criteria. Try adjusting filters.
                  </td>
                </tr>
              ) : (
                filteredStocks.map((s) => (
                  <tr 
                    key={s.symbol} 
                    className="hover:bg-surface-container-low/40 transition-colors cursor-pointer group"
                    onClick={() => onSelectStock(s.symbol)}
                  >
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white text-xs tracking-wide relative"
                          style={{ backgroundColor: getAssetColor(s.symbol) }}
                        >
                          {s.symbol}
                          <span className="absolute -bottom-1 -right-1 text-[8px] bg-primary-container text-white rounded-full w-4 h-4 flex items-center justify-center border border-white">
                            {(s.assetType || "Stock") === "Crypto" ? "🪙" : "💼"}
                          </span>
                        </div>
                        <div>
                          <div className="font-bold text-primary group-hover:text-secondary transition-colors text-base leading-tight">
                            {s.name}
                          </div>
                          <div className="text-xs font-mono text-on-surface-variant mt-1">
                            {s.sector} • {s.frequency}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="font-mono text-sm font-semibold text-primary">
                        {formatCurrency(s.price, settings.currency)}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-secondary font-extrabold text-sm font-mono">
                      {s.yield.toFixed(2)}%
                    </td>
                    <td className="px-6 py-5">
                      <div className="flex items-center gap-1 text-on-secondary-container bg-secondary-container/30 px-2.5 py-1 rounded-full w-fit">
                        <TrendingUp className="w-3.5 h-3.5 text-secondary" />
                        <span className="font-mono text-xs font-bold">{s.growth5y}%</span>
                      </div>
                    </td>
                    <td className="px-6 py-5">
                      <span className="font-mono text-sm font-semibold text-primary">
                        {(s.assetType || "Stock") === "Crypto" ? "N/A" : `${s.payoutRatio}%`}
                      </span>
                    </td>
                    <td className="px-6 py-5 w-36">
                      {/* Interactive Sparkline Blocks */}
                      <div className="h-8 w-full bg-secondary-container/10 flex items-end gap-1 p-1 rounded border border-secondary-container/20">
                        {s.historySparkline.map((h, i) => (
                          <div 
                            key={i} 
                            style={{ height: `${h}%` }}
                            className="bg-secondary/40 rounded-xs w-full hover:bg-secondary transition-all"
                          ></div>
                        ))}
                      </div>
                    </td>
                    <td className="px-6 py-5 text-right">
                      <ChevronRight className="w-5 h-5 text-outline group-hover:text-primary transition-colors inline-block" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer / Pagination */}
        <div className="bg-surface-container-low px-6 py-4 border-t border-outline-variant flex justify-between items-center text-xs text-on-surface-variant font-medium">
          <span>Showing 1-{filteredStocks.length} of {filteredStocks.length} stocks</span>
          <div className="flex gap-2">
            <button className="px-3.5 py-1.5 border border-outline-variant rounded bg-white hover:bg-surface-container transition-colors font-semibold shadow-xs disabled:opacity-50" disabled>
              Previous
            </button>
            <button className="px-3.5 py-1.5 border border-outline-variant rounded bg-white hover:bg-surface-container transition-colors font-semibold shadow-xs disabled:opacity-50" disabled>
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Featured Insight Area (Bento Layout) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12" id="scanner-insight-bento">
        
        {/* Value Trap Guide (Bento Left) */}
        <div className="md:col-span-2 bg-primary-container text-on-primary rounded-2xl p-6 flex flex-col justify-between relative overflow-hidden h-64 border border-outline-variant/10 shadow-sm hover:shadow-md transition-shadow">
          <div className="z-10">
            <span className="bg-secondary text-white text-[10px] font-bold px-2.5 py-1 rounded-full font-mono mb-4 inline-block tracking-wider uppercase">
              INSIDER INSIGHT
            </span>
            <h3 className="text-xl md:text-2xl font-bold leading-tight max-w-lg mt-1">
              Why High Yield Isn't Always the High Road: The Value Trap Guide
            </h3>
            <p className="text-xs text-on-primary-container/80 mt-2 max-w-md">
              Learn how to avoid yields that are unsustainably high and indicate structural company distress before they cut payouts.
            </p>
          </div>
          <button 
            onClick={() => onOpenAiAssistant("Generate a deep dive lesson on Value Traps in dividend investing. Explain specifically how to identify unsustainably high dividend yields, payout ratio warnings, and structural earnings declines. Provide real stock examples or formulas.")}
            className="z-10 flex items-center gap-2 font-bold hover:underline text-sm self-start"
          >
            Read the full analysis 
            <ArrowRight className="w-4 h-4 text-secondary-container" />
          </button>
          {/* Decorative radial ambient flare */}
          <div className="absolute -right-12 -bottom-12 w-48 h-48 bg-secondary-container/20 rounded-full blur-3xl pointer-events-none"></div>
        </div>

        {/* Upgrade Card (Bento Right) */}
        <div className="bg-surface-container-high/60 rounded-2xl p-6 border border-outline-variant flex flex-col justify-center items-center text-center shadow-sm">
          <Star className="w-10 h-10 text-primary mb-3 fill-primary" />
          <h4 className="text-lg font-bold mb-1 text-primary">Upgrade to Pro</h4>
          <p className="text-on-surface-variant text-xs md:text-sm mb-5 px-4 leading-relaxed">
            Unlock 20+ specialized valuation metrics, automated cashflow projections, and smart portfolio rebalancing alerts.
          </p>
          <button className="w-full bg-primary hover:bg-opacity-95 text-on-primary py-3 rounded-xl font-bold text-sm shadow-sm transition-transform active:scale-95">
            Start Free Trial
          </button>
        </div>

      </div>

      {/* Save Filter / Floating Contextual Add Action */}
      <div className="fixed bottom-24 right-4 md:bottom-12 md:right-8 z-40">
        <button 
          id="btn-add-custom-stock"
          onClick={() => setShowAddCustomModal(true)}
          className="w-14 h-14 bg-primary hover:bg-opacity-95 text-on-primary rounded-full shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-all group relative"
          title="Add Custom Asset to Scanner"
        >
          <Plus className="w-6 h-6" />
          <span className="absolute right-full mr-3 bg-primary text-on-primary px-3 py-1.5 rounded-lg text-xs font-bold font-mono uppercase tracking-wide opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-md pointer-events-none">
            Add Custom Asset
          </span>
        </button>
      </div>

      {/* Add Custom Stock Modal */}
      {showAddCustomModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-fade-in">
          <div className="bg-white border border-outline-variant rounded-2xl max-w-md w-full p-6 shadow-xl relative animate-scale-up">
            <h3 className="text-xl font-bold text-primary mb-2">Add Custom Stock</h3>
            <p className="text-sm text-on-surface-variant mb-6">Create a synthetic asset or define a local stock for dividend simulation and AI safety analysis.</p>
            
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
                  <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Company / Asset Name</label>
                  <input
                    type="text"
                    placeholder={customStock.assetType === "Crypto" ? "e.g. Ethereum Staking" : "e.g. Schwab Dividend"}
                    value={customStock.name}
                    onChange={(e) => setCustomStock(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-4 py-2.5 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Sector / Category</label>
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
                <label className="block text-[10px] font-bold text-outline uppercase tracking-wider mb-1">Pick Rationale / Description</label>
                <textarea
                  value={customStock.whyPick}
                  onChange={(e) => setCustomStock(prev => ({ ...prev, whyPick: e.target.value }))}
                  className="w-full px-4 py-2 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none h-16"
                  placeholder={customStock.assetType === "Crypto" ? "Why is this staking or yield pool a good option?" : "Why is this stock a good option?"}
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
                  className="px-5 py-2 text-sm font-bold bg-primary text-on-primary hover:bg-opacity-90 rounded-lg transition-transform active:scale-95"
                >
                  Add to Scanner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
