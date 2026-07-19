import React, { useState, useEffect } from "react";
import { createChart, ColorType, AreaSeries } from "lightweight-charts";
import { Stock, Transaction, UserSettings } from "../types";
import { getAssetColor, formatCurrency } from "../utils";
import { 
  TrendingUp, 
  TrendingDown, 
  Plus, 
  Bookmark, 
  ShieldCheck, 
  Clock, 
  HelpCircle,
  Briefcase,
  AlertTriangle,
  Calendar,
  DollarSign,
  Activity,
  Sparkles,
  RefreshCw,
  Send,
  Layers
} from "lucide-react";
import { OptionsAnalysis } from "./OptionsAnalysis";

interface AnalysisViewProps {
  stock: Stock;
  isPro: boolean;
  onAddTransaction: (tx: { type: "Buy" | "Dividend"; asset: string; amount: number; date: string; isIncome: boolean }) => void;
  onAddWatchlist: (symbol: string) => void;
  isWatched: boolean;
  settings: UserSettings;
}

export default function AnalysisView({
  stock,
  isPro,
  onAddTransaction,
  onAddWatchlist,
  isWatched,
  settings
}: AnalysisViewProps) {
  const [selectedPeriod, setSelectedPeriod] = useState("1M");
  const isCrypto = stock.assetType === "Crypto";
  
  // AI Analysis state
  const [aiReport, setAiReport] = useState<string>("");
  const [isLoadingAi, setIsLoadingAi] = useState<boolean>(false);
  const [customQuestion, setCustomQuestion] = useState<string>("");
  const [aiError, setAiError] = useState<string>("");

  // Quick trade modal
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [buyShares, setBuyShares] = useState(10);
  
  const totalCost = buyShares * stock.price;

  const chartContainerRef = React.useRef<HTMLDivElement>(null);

  const [overlayActive, setOverlayActive] = useState(false);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Generate daily historical ticks mock data
    const basePrice = stock.price;
    const dataPoints = [];
    const date = new Date();
    date.setDate(date.getDate() - 90);

    for (let i = 0; i < 90; i++) {
      const dateStr = date.toISOString().split("T")[0];
      const dailyNoise = (Math.sin(i / 8) * 0.04 + (Math.random() - 0.5) * 0.015) * basePrice;
      dataPoints.push({
        time: dateStr,
        value: Number((basePrice + dailyNoise).toFixed(2))
      });
      date.setDate(date.getDate() + 1);
    }

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#64748b",
      },
      grid: {
        vertLines: { color: "rgba(226, 232, 240, 0.15)" },
        horzLines: { color: "rgba(226, 232, 240, 0.15)" },
      },
      width: container.clientWidth,
      height: 256,
    });

    const newSeries = chart.addSeries(AreaSeries, {
      lineColor: isCrypto ? "#f59e0b" : "#10b981", // Amber for crypto, green for stock
      topColor: isCrypto ? "rgba(245, 158, 11, 0.2)" : "rgba(16, 185, 129, 0.2)",
      bottomColor: isCrypto ? "rgba(245, 158, 11, 0)" : "rgba(16, 185, 129, 0)",
      lineWidth: 2,
    });

    newSeries.setData(dataPoints);
    chart.timeScale().fitContent();

    // Secure WebSocket Connection for Real-Time Ticks
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProto}//${window.location.host}/ws/marketdata`);
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ action: "subscribe", symbol: stock.symbol }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "tick" && msg.symbol === stock.symbol) {
          // Update the chart with the real-time tick
          const today = new Date().toISOString().split('T')[0];
          newSeries.update({ time: today, value: msg.price });
        }
      } catch (e) {
        // Ignore parse errors from welcome messages
      }
    };

    let overlaySeries: any = null;
    if (overlayActive) {
      fetch("/api/lse/macro")
        .then(res => res.json())
        .then(data => {
          overlaySeries = chart.addLineSeries({
            color: "#6366f1", // Indigo
            lineWidth: 2,
            priceScaleId: 'left' // Put overlay on left axis
          });
          chart.priceScale('left').applyOptions({ visible: true });
          overlaySeries.setData(data.data);
        });
    }

    const handleResize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      ws.close();
      chart.remove();
    };
  }, [stock.price, stock.symbol, isCrypto, overlayActive]);

  // Auto-fetch analysis when stock changes
  useEffect(() => {
    generateAiAnalysis();
  }, [stock.symbol]);

  const generateAiAnalysis = async (userPrompt?: string) => {
    setIsLoadingAi(true);
    setAiError("");
    try {
      const response = await fetch("/api/gemini/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: stock.symbol,
          name: stock.name,
          sector: stock.sector,
          price: stock.price,
          yieldVal: stock.yield,
          payoutRatio: stock.payoutRatio,
          safetyScore: stock.safetyScore,
          whyPick: stock.whyPick,
          customPrompt: userPrompt,
          assetType: stock.assetType || "Stock"
        }),
      });
      const data = await response.json();
      if (response.ok) {
        if (userPrompt) {
          // Append custom answer to standard report
          setAiReport(prev => prev + `\n\n---\n\n### Custom Query: ${userPrompt}\n\n${data.analysis}`);
        } else {
          setAiReport(data.analysis);
        }
      } else {
        setAiError(data.error || "Failed to generate safety report.");
      }
    } catch (err: any) {
      console.error(err);
      setAiError("Connection to the server failed. Make sure your GEMINI_API_KEY is configured.");
    } finally {
      setIsLoadingAi(false);
    }
  };

  const handleCustomQuestionSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customQuestion.trim()) return;
    generateAiAnalysis(customQuestion);
    setCustomQuestion("");
  };

  const handleBuySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddTransaction({
      type: "Buy",
      asset: stock.symbol,
      amount: totalCost,
      date: "Today, " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isIncome: false
    });
    setShowBuyModal(false);
    alert(`Successfully simulated purchase of ${buyShares} shares of ${stock.symbol} for ${formatCurrency(totalCost, settings.currency)}!`);
  };

  // Safe status styling
  const safetyColor = stock.safetyScore >= 80 ? "text-secondary border-secondary bg-secondary-container/20" : 
                       stock.safetyScore >= 60 ? "text-amber-600 border-amber-300 bg-amber-50" : "text-error border-error bg-red-50";

  return (
    <div className="space-y-8 animate-fade-in" id="analysis-view-container">
      {/* Header Info Section */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 shadow-xs" id="stock-header-card">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span 
                className="text-white text-[10px] font-bold font-mono px-2.5 py-0.5 rounded-md uppercase tracking-wider shadow-sm"
                style={{ backgroundColor: getAssetColor(stock.symbol) }}
              >
                NYSE: {stock.symbol}
              </span>
              <span className="text-on-surface-variant font-mono text-xs font-semibold uppercase tracking-wider">
                {stock.sector} • {stock.frequency} Payer
              </span>
            </div>
            <h2 className="text-3xl md:text-4xl font-extrabold text-primary tracking-tight">
              {stock.name}
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-2xl font-bold font-mono text-primary">{formatCurrency(stock.price, settings.currency)}</span>
              <span className="text-secondary font-mono text-xs font-bold flex items-center bg-secondary-container/30 px-2 py-0.5 rounded-full">
                <TrendingUp className="w-3.5 h-3.5 mr-0.5" />
                +1.24 (2.34%)
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            <button 
              id="btn-buy-shares"
              onClick={() => setShowBuyModal(true)}
              className="bg-primary text-on-primary hover:bg-opacity-90 px-6 py-3 rounded-xl font-bold text-sm shadow-sm transition-transform active:scale-95"
            >
              Buy Shares
            </button>
            <button 
              id="btn-add-watchlist"
              onClick={() => onAddWatchlist(stock.symbol)}
              className={`border px-6 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 active:scale-95 shadow-sm ${
                isWatched 
                  ? "bg-secondary text-on-secondary border-secondary" 
                  : "bg-surface-container-lowest border-outline-variant text-primary hover:bg-surface-container"
              }`}
            >
              <Bookmark className="w-4 h-4 fill-current" />
              {isWatched ? "In Watchlist" : "Add to Watchlist"}
            </button>
          </div>
        </div>
      </section>

      {/* Bento Grid Analysis Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6" id="analysis-bento">
        
        {/* Main Price Chart Wave */}
        <div className="md:col-span-8 bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-primary flex items-center gap-2">
              Price Performance
              <button 
                onClick={() => setOverlayActive(!overlayActive)}
                className={`flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md font-mono uppercase tracking-wider transition-colors ${
                  overlayActive ? "bg-indigo-100 text-indigo-700" : "bg-surface text-on-surface-variant hover:bg-surface-container"
                }`}
                title="Toggle 10-Year Treasury Yield Macro Overlay"
              >
                <Layers size={14} />
                {overlayActive ? "Overlay Active" : "Add Macro Overlay"}
              </button>
            </h3>
            <div className="flex gap-1 bg-surface-container-low p-1 rounded-xl hidden sm:flex">
              {["1D", "1W", "1M", "1Y", "5Y"].map((period) => (
                <button
                  key={period}
                  onClick={() => setSelectedPeriod(period)}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                    selectedPeriod === period 
                      ? "bg-white text-primary shadow-sm" 
                      : "text-on-surface-variant hover:text-primary"
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive TradingView Chart Container */}
          <div className="h-64 relative border border-outline-variant/20 rounded-xl bg-surface/10 overflow-hidden" ref={chartContainerRef} id="chart-stage" />
        </div>

        {/* Dividend Safety Score Card */}
        <div className="md:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <h3 className="text-lg font-bold text-primary mb-1">Dividend Safety</h3>
            <p className="text-xs text-on-surface-variant leading-relaxed">Based on cash flow sustainability, AFFO ratios, earnings stability, and historical payout track records.</p>
          </div>

          <div className="flex flex-col items-center py-6">
            <div className="relative w-32 h-32 flex items-center justify-center">
              {/* Custom circle SVG progress gauge */}
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <circle className="stroke-surface-container-highest" cx="18" cy="18" fill="none" r="16" strokeWidth="3"></circle>
                <circle 
                  className="stroke-secondary transition-all duration-1000" 
                  cx="18" 
                  cy="18" 
                  fill="none" 
                  r="16" 
                  strokeDasharray={`${stock.safetyScore}, 100`} 
                  strokeLinecap="round" 
                  strokeWidth="3"
                ></circle>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-extrabold text-primary font-mono">{stock.safetyScore}</span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-secondary">
                  {stock.safetyScore >= 80 ? "Very Safe" : stock.safetyScore >= 60 ? "Safe" : "Risky"}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold text-on-surface-variant font-mono">
              <span>Market Average</span>
              <span>64 / 100</span>
            </div>
            <div className="w-full bg-surface-container-highest h-1 rounded-full overflow-hidden">
              <div className="bg-on-surface-variant h-full w-[64%]"></div>
            </div>
          </div>
        </div>

        {/* Metric Highlights Underneath */}
        <div className="md:col-span-3 bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 hover:shadow-md transition-shadow">
          <span className="text-xs font-semibold text-on-surface-variant font-mono block mb-1 uppercase tracking-wider">
            {isCrypto ? "Staking Yield" : "Dividend Yield"}
          </span>
          <span className="text-2xl font-extrabold text-primary font-mono">{stock.yield.toFixed(2)}%</span>
          <div className="mt-4 flex items-center gap-1.5">
            <span className="bg-secondary-container text-on-secondary-container font-mono font-bold text-[10px] px-2 py-0.5 rounded-full">
              {isCrypto ? "Native Protocol APY" : "+0.12% vs Sector"}
            </span>
          </div>
        </div>

        <div className="md:col-span-3 bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 hover:shadow-md transition-shadow">
          <span className="text-xs font-semibold text-on-surface-variant font-mono block mb-1 uppercase tracking-wider">
            {isCrypto ? "Estimated Yield" : "Annual Payout"}
          </span>
          <span className="text-2xl font-extrabold text-primary font-mono">
            {isCrypto ? `${stock.yield.toFixed(2)}%` : `${formatCurrency(stock.price * stock.yield / 100, settings.currency)}`}
          </span>
          <p className="mt-4 text-[10px] text-on-surface-variant leading-tight">
            {isCrypto 
              ? `Staking payout distributed continuously (simulated monthly)`
              : `Paid out in ${stock.frequency.toLowerCase()} installments of ${formatCurrency(stock.price * stock.yield / 100 / (stock.frequency === "Monthly" ? 12 : 4), settings.currency)}`
            }
          </p>
        </div>

        <div className="md:col-span-3 bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 hover:shadow-md transition-shadow">
          <span className="text-xs font-semibold text-on-surface-variant font-mono block mb-1 uppercase tracking-wider">
            {isCrypto ? "Token Inflation Rate" : "Payout Ratio (AFFO)"}
          </span>
          <span className="text-2xl font-extrabold text-primary font-mono">
            {isCrypto ? `${stock.payoutRatio}%` : `${stock.payoutRatio}%`}
          </span>
          <div className="mt-4 w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
            <div className="bg-secondary h-full rounded-full" style={{ width: `${stock.payoutRatio}%` }}></div>
          </div>
        </div>

        <div className="md:col-span-3 bg-surface-container-lowest border border-outline-variant rounded-2xl p-5 hover:shadow-md transition-shadow">
          <span className="text-xs font-semibold text-on-surface-variant font-mono block mb-1 uppercase tracking-wider">
            {isCrypto ? "Asset Class" : "Growth Streak"}
          </span>
          <span className="text-2xl font-extrabold text-primary font-mono">
            {isCrypto ? "DeFi Yield" : "26 Years"}
          </span>
          <p className="mt-4 text-[10px] text-on-surface-variant leading-tight">
            {isCrypto ? "Cryptocurrency protocol incentives" : "S&P 500 Dividend Aristocrat status"}
          </p>
        </div>

        {/* Growth History Chart */}
        <div className="md:col-span-12 bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-bold text-primary">Dividend Growth History</h3>
              <p className="text-xs text-on-surface-variant mt-0.5">Trailing payout trajectory and compound annual growth rates</p>
            </div>
            <div className="text-right">
              <span className="text-xs text-on-surface-variant font-mono block">CAGR (5Y)</span>
              <span className="text-lg font-extrabold text-secondary font-mono">3.8%</span>
            </div>
          </div>

          <div className="flex items-end gap-2 h-44 w-full px-2" id="growth-history-bars">
            {stock.dividendGrowthHistory.map((item, i) => {
              const maxVal = Math.max(...stock.dividendGrowthHistory.map(d => d.payout));
              const heightPct = (item.payout / maxVal) * 100;
              return (
                <div key={i} className="flex-1 flex flex-col items-center group">
                  <div 
                    style={{ height: `${heightPct}%` }}
                    className={`w-full rounded-t-sm transition-all group-hover:bg-secondary/80 cursor-pointer ${
                      i === stock.dividendGrowthHistory.length - 1 ? "bg-secondary" : "bg-surface-container-highest"
                    }`}
                    title={`Payout: ${formatCurrency(item.payout, settings.currency)}`}
                  ></div>
                  <span className="text-[9px] text-outline mt-2 font-mono">{item.year}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detailed Fundamentals Table */}
        <div className="md:col-span-12 bg-white border border-outline-variant rounded-2xl overflow-hidden shadow-xs">
          <div className="bg-surface-container-low px-6 py-3 border-b border-outline-variant">
            <h4 className="text-xs font-bold font-mono text-on-surface-variant uppercase tracking-wider">Detailed Fundamentals</h4>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-outline-variant">
            <div className="p-6 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-on-surface-variant font-medium">Market Cap</span>
                <span className="font-bold text-primary font-mono">{settings.currency === 'USD' ? '$' : settings.currency === 'EUR' ? '€' : settings.currency === 'GBP' ? '£' : settings.currency === 'JPY' ? '¥' : '$'}{stock.marketCap}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant font-medium">P/AFFO</span>
                <span className="font-bold text-primary font-mono">{stock.pAffo}</span>
              </div>
            </div>
            <div className="p-6 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-on-surface-variant font-medium">Ex-Dividend Date</span>
                <span className="font-bold text-primary font-mono">{stock.exDivDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant font-medium">Pay Date</span>
                <span className="font-bold text-primary font-mono">{stock.payDate}</span>
              </div>
            </div>
            <div className="p-6 space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-on-surface-variant font-medium">Dividend Type</span>
                <span className="font-bold text-primary font-mono">{stock.divType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant font-medium">Frequency</span>
                <span className="font-bold text-primary font-mono">{stock.frequency}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Full-Stack Gemini AI Security Analysis Card */}
        <div className="md:col-span-12 bg-surface-container-low/30 border border-outline-variant rounded-2xl p-6 space-y-6 hover:shadow-md transition-shadow">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="bg-secondary p-2 rounded-xl text-white">
                <Sparkles className="w-5 h-5 fill-white" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-primary flex items-center gap-1.5">
                  Lumina AI Pro Safety Forecast
                </h3>
                <p className="text-xs text-on-surface-variant">Real-time LLM-driven research and trap alerts compiled by Gemini 3.5</p>
              </div>
            </div>
            
            <button 
              onClick={() => generateAiAnalysis()}
              disabled={isLoadingAi}
              className="flex items-center gap-1.5 bg-secondary text-white hover:bg-opacity-95 text-xs font-bold font-mono px-4 py-2 rounded-xl shadow-xs transition-transform active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAi ? "animate-spin" : ""}`} />
              RE-RUN RESEARCH
            </button>
          </div>

          {/* AI Output Box */}
          <div className="bg-white border border-outline-variant rounded-xl p-5 min-h-[160px] max-h-[420px] overflow-y-auto font-body-md text-sm leading-relaxed prose prose-slate">
            {isLoadingAi ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4">
                <Activity className="w-8 h-8 text-secondary animate-pulse" />
                <p className="text-xs font-semibold text-on-surface-variant animate-pulse font-mono uppercase tracking-widest">
                  Compiling structural safety ratios & earnings trends...
                </p>
              </div>
            ) : aiError ? (
              <div className="flex flex-col items-center justify-center text-center py-6 text-red-600 space-y-2">
                <AlertTriangle className="w-8 h-8 text-error" />
                <p className="font-semibold">{aiError}</p>
                <p className="text-xs text-on-surface-variant">Configure process.env.GEMINI_API_KEY in secrets menu to activate.</p>
              </div>
            ) : (
              <div className="space-y-4 whitespace-pre-wrap text-primary" id="ai-report-content">
                {aiReport || "Report generation failed or empty."}
              </div>
            )}
          </div>

          {/* User Prompt Interaction Form */}
          <form onSubmit={handleCustomQuestionSubmit} className="flex gap-3">
            <input 
              type="text" 
              placeholder={`Ask Gemini about ${stock.symbol} (e.g. "Will they cut dividends if vacancy rates increase?")`}
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              className="flex-grow px-4 py-3 bg-white border border-outline-variant rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent text-primary font-medium"
            />
            <button 
              type="submit"
              disabled={isLoadingAi || !customQuestion.trim()}
              className="bg-primary text-on-primary px-5 py-3 rounded-xl flex items-center justify-center transition-transform active:scale-95 hover:bg-opacity-90 disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Options Analysis Component (LSE) */}
        {!isCrypto && (
          <div className="md:col-span-12 bg-white border border-outline-variant rounded-2xl p-6 hover:shadow-md transition-shadow">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-bold text-primary">Options Chain Yields</h3>
                <p className="text-xs text-on-surface-variant mt-0.5">Real-time options data provided by LSE</p>
              </div>
            </div>
            <OptionsAnalysis symbol={stock.symbol} />
          </div>
        )}

      </div>

      {/* Share Buy Modal */}
      {showBuyModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-fade-in">
          <div className="bg-white border border-outline-variant rounded-2xl max-w-sm w-full p-6 shadow-xl relative animate-scale-up">
            <h3 className="text-xl font-bold text-primary mb-2">Simulate Purchase</h3>
            <p className="text-sm text-on-surface-variant mb-6">Log shares purchased to update your portfolio compounding balance.</p>
            
            <form onSubmit={handleBuySubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-outline uppercase tracking-wider mb-2">Shares to Buy</label>
                <input 
                  type="number" 
                  min="1" 
                  step="1"
                  value={buyShares}
                  onChange={(e) => setBuyShares(Number(e.target.value))}
                  className="w-full px-4 py-3 bg-surface border border-outline-variant rounded-xl focus:outline-none focus:ring-2 focus:ring-primary font-mono text-base font-bold text-primary"
                />
              </div>

              <div className="bg-surface-container-low p-4 rounded-xl space-y-2 text-sm font-medium">
                <div className="flex justify-between text-on-surface-variant">
                  <span>Price per Share</span>
                  <span className="font-mono font-bold">{formatCurrency(stock.price, settings.currency)}</span>
                </div>
                <div className="flex justify-between text-primary pt-2 border-t border-outline-variant font-bold">
                  <span>Estimated Cost</span>
                  <span className="font-mono text-base">{formatCurrency(totalCost, settings.currency)}</span>
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-outline-variant">
                <button
                  type="button"
                  onClick={() => setShowBuyModal(false)}
                  className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 text-sm font-bold bg-primary text-on-primary hover:bg-opacity-90 rounded-lg transition-transform active:scale-95"
                >
                  Confirm Purchase
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
