import React, { useState } from "react";
import { Stock, Transaction, Payout } from "../types";
import { getAssetColor, formatCurrency } from "../utils";
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Plus, 
  Download, 
  Layers, 
  BarChart3, 
  Clock, 
  ShoppingCart, 
  FileSpreadsheet, 
  Sparkles,
  ChevronRight,
  Sparkle
} from "lucide-react";

interface PortfolioViewProps {
  stocks: Stock[];
  transactions: Transaction[];
  payouts: Payout[];
  onAddTransaction: (tx: Omit<Transaction, "id">) => void;
  onSelectStock: (symbol: string) => void;
  isPro: boolean;
  onOpenAiAssistant: (initialPrompt?: string) => void;
  settings: UserSettings;
}

export default function PortfolioView({
  stocks,
  transactions,
  payouts,
  onAddTransaction,
  onSelectStock,
  isPro,
  onOpenAiAssistant,
  settings
}: PortfolioViewProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTx, setNewTx] = useState({
    type: "Buy" as "Buy" | "Dividend",
    asset: "O",
    amount: 1000,
    date: "Today, " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  const portfolioValue = 482910.42;
  const portfolioChange = 2140.21;
  const portfolioPercent = 0.44;

  const estimatedPayout = 1240.15;
  const mtdGrowth = 12.4;

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAddTransaction({
      type: newTx.type,
      asset: newTx.asset.toUpperCase(),
      amount: Number(newTx.amount),
      date: newTx.date,
      isIncome: newTx.type === "Dividend"
    });
    setShowAddModal(false);
  };

  const handleExportCSV = () => {
    const headers = ["ID", "Type", "Asset", "Date", "Amount", "Is Income"];
    const rows = transactions.map(tx => [
      tx.id,
      tx.type,
      tx.asset,
      tx.date,
      `${formatCurrency(tx.amount, settings.currency)}`,
      tx.isIncome ? "Yes" : "No"
    ]);
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "dividend_pro_transactions.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8 animate-fade-in" id="portfolio-view-container">
      {/* Hero Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6" id="portfolio-header">
        <div>
          <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-widest font-mono mb-1">
            Global Portfolio
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-primary transition-all duration-300">
            {formatCurrency(portfolioValue, settings.currency)}
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-secondary-container text-on-secondary-container">
              <TrendingUp className="w-3.5 h-3.5 mr-1" />
              +${portfolioChange.toLocaleString("en-US", { minimumFractionDigits: 2 })} ({portfolioPercent}%)
            </span>
            <span className="text-on-surface-variant text-xs">Today's Performance</span>
          </div>
        </div>
        
        <div className="flex gap-3">
          <button 
            id="btn-buy-asset"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-primary text-on-primary hover:bg-opacity-90 px-5 py-2.5 rounded-xl text-sm font-bold transition-transform active:scale-95 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Buy Asset
          </button>
          <button 
            id="btn-export"
            onClick={handleExportCSV}
            className="flex items-center gap-2 bg-surface-container-lowest border border-outline-variant text-primary hover:bg-surface-container transition-colors px-5 py-2.5 rounded-xl text-sm font-bold active:scale-95 shadow-sm"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Bento Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6" id="portfolio-bento">
        {/* Left Column: Key metrics cards and chart */}
        <div className="md:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
          
          {/* Estimated Payout */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200">
            <div className="flex justify-between items-start mb-6">
              <div className="p-3 rounded-xl bg-surface-container-high text-primary">
                <DollarSign className="w-6 h-6 text-secondary" />
              </div>
              <span className="text-on-surface-variant font-mono text-xs font-semibold uppercase tracking-wider">NEXT 30 DAYS</span>
            </div>
            <div>
              <p className="text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Estimated Payout</p>
              <p className="text-3xl font-extrabold text-primary">{formatCurrency(estimatedPayout, settings.currency, { maximumFractionDigits: 0 })}</p>
            </div>
          </div>

          {/* Monthly Growth */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 flex flex-col justify-between hover:shadow-md transition-shadow duration-200">
            <div className="flex justify-between items-start mb-6">
              <div className="p-3 rounded-xl bg-surface-container-high text-primary">
                <TrendingUp className="w-6 h-6 text-on-tertiary-container" />
              </div>
              <span className="text-on-surface-variant font-mono text-xs font-semibold uppercase tracking-wider">MTD</span>
            </div>
            <div>
              <p className="text-xs font-semibold text-on-surface-variant mb-1 uppercase tracking-wider">Dividend Growth</p>
              <p className="text-3xl font-extrabold text-primary">+{mtdGrowth}%</p>
            </div>
          </div>

          {/* Dividend Yield Distribution Chart */}
          <div className="sm:col-span-2 bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 overflow-hidden relative min-h-[320px] hover:shadow-md transition-shadow duration-200">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-bold text-primary">Yield Distribution</h3>
                <p className="text-sm text-on-surface-variant">Asset concentration by yield percentage</p>
              </div>
              <BarChart3 className="w-5 h-5 text-outline" />
            </div>

            {/* Custom chart visualization */}
            <div className="flex items-end justify-between h-40 gap-3 px-2 pt-4">
              <div className="w-full flex flex-col items-center group">
                <div className="w-full bg-secondary rounded-t-lg transition-all group-hover:opacity-80" style={{ height: "40%" }}></div>
                <span className="text-[10px] text-outline mt-2 font-mono">0-2%</span>
              </div>
              <div className="w-full flex flex-col items-center group">
                <div className="w-full bg-on-tertiary-container rounded-t-lg transition-all group-hover:opacity-80" style={{ height: "85%" }}></div>
                <span className="text-[10px] text-outline mt-2 font-mono">2-4%</span>
              </div>
              <div className="w-full flex flex-col items-center group">
                <div className="w-full bg-secondary/40 rounded-t-lg transition-all group-hover:opacity-80" style={{ height: "60%" }}></div>
                <span className="text-[10px] text-outline mt-2 font-mono">4-6%</span>
              </div>
              <div className="w-full flex flex-col items-center group">
                <div className="w-full bg-on-primary-container rounded-t-lg transition-all group-hover:opacity-80" style={{ height: "45%" }}></div>
                <span className="text-[10px] text-outline mt-2 font-mono">6-8%</span>
              </div>
              <div className="w-full flex flex-col items-center group">
                <div className="w-full bg-outline-variant rounded-t-lg transition-all group-hover:opacity-80" style={{ height: "30%" }}></div>
                <span className="text-[10px] text-outline mt-2 font-mono">8-10%</span>
              </div>
              <div className="w-full flex flex-col items-center group">
                <div className="w-full bg-secondary rounded-t-lg transition-all group-hover:opacity-80" style={{ height: "70%" }}></div>
                <span className="text-[10px] text-outline mt-2 font-mono">10%+</span>
              </div>
            </div>
            
            <div className="border-t border-outline-variant mt-4 pt-3 text-center">
              <span className="text-xs text-on-surface-variant font-medium">Distribution reflects diversified high and low yield balance</span>
            </div>
          </div>

        </div>

        {/* Right Column: Recent Activity and Interactive AI Card */}
        <div className="md:col-span-4 bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 h-full flex flex-col hover:shadow-md transition-shadow duration-200">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-primary">Recent Activity</h3>
            <span className="text-xs font-mono text-outline uppercase">Logged</span>
          </div>

          <div className="space-y-4 flex-grow overflow-y-auto max-h-[340px] pr-1">
            {transactions.slice(0, 5).map((tx) => (
              <div 
                key={tx.id} 
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-container-low transition-colors duration-150 border border-transparent hover:border-outline-variant/20 cursor-pointer"
                onClick={() => onSelectStock(tx.asset)}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                  tx.type === "Dividend" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-primary"
                }`}>
                  {tx.type === "Dividend" ? (
                    <TrendingUp className="w-5 h-5 text-secondary" />
                  ) : (
                    <ShoppingCart className="w-5 h-5 text-primary" />
                  )}
                </div>
                <div className="flex-grow min-w-0">
                  <p className="text-sm font-semibold text-primary truncate flex items-center gap-1.5">
                    {tx.type === "Dividend" ? "Dividend: " : "Buy: "}{tx.asset}
                    {stocks.find(s => s.symbol === tx.asset)?.assetType === "Crypto" && (
                      <span className="text-[10px]" title="Crypto Asset">🪙</span>
                    )}
                  </p>
                  <p className="text-xs text-on-surface-variant font-mono">{tx.date}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-bold font-mono ${tx.isIncome ? "text-secondary" : "text-on-surface-variant"}`}>
                    {tx.isIncome ? "+" : "-"}{formatCurrency(tx.amount, settings.currency)}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Dynamic AI Banner with instant action */}
          <div className="mt-6 rounded-2xl overflow-hidden aspect-video relative group border border-outline-variant/30">
            <img 
              alt="Trading desk" 
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              referrerPolicy="no-referrer"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuC2iRaL_SSqGUnTloHW4EmL4cItu9uG7SPt7fOhf4FH-EaHS9fp7uGYiELQJyijF5dBtpmQxuRXmjU9WVxvOy5p9BBD00YMwztRL2J5ewh-5EnPz9VMQuY_InSh_3qtUXRWsBgxGilp9MaB8__CbfzZh_3OeWTu29LP78cSCIRlbTmDJkNZiRyAVQZXpw6c8_pGrJDFA3guF74ncRYczdsAeLoGTTdZwfDNqB0Bjs-ybvqiSaQO-Byl0A"
            />
            <div className="absolute inset-0 bg-black/50 hover:bg-black/40 transition-colors flex flex-col justify-between p-4">
              <span className="self-start inline-flex items-center gap-1 bg-secondary text-white text-[10px] font-bold px-2 py-0.5 rounded-full font-mono uppercase tracking-wider">
                <Sparkle className="w-3 h-3 fill-white" />
                AI Integration
              </span>
              <div className="space-y-1.5">
                <p className="text-white font-bold text-sm leading-snug">
                  New: AI Powered Dividend Forecast Now Available
                </p>
                <button 
                  onClick={() => onOpenAiAssistant("Please provide a long-term cash flow and compounding growth forecast for my Global Portfolio of $482,910.42 yielding an average of ~5%. What will the payouts look like in 5, 10, and 20 years?")}
                  className="inline-flex items-center gap-1 text-xs text-secondary-container font-semibold hover:underline"
                >
                  Analyze Portfolio Yield <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Upcoming Payouts Table */}
      <section className="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-hidden shadow-sm" id="upcoming-payouts-section">
        <div className="px-6 py-5 border-b border-outline-variant flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <h2 className="text-xl font-bold text-primary">Upcoming Payouts</h2>
            <p className="text-sm text-on-surface-variant">Scheduled dividend payments for your watched assets</p>
          </div>
          <span className="text-xs font-mono font-semibold text-on-surface-variant bg-surface-container px-3 py-1 rounded-full uppercase tracking-wider">
            Filter: Next Month
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant">
                <th className="px-6 py-4 text-xs font-bold font-mono text-outline uppercase tracking-wider">Ticker</th>
                <th className="px-6 py-4 text-xs font-bold font-mono text-outline uppercase tracking-wider">Amount</th>
                <th className="px-6 py-4 text-xs font-bold font-mono text-outline uppercase tracking-wider">Ex-Date</th>
                <th className="px-6 py-4 text-xs font-bold font-mono text-outline uppercase tracking-wider">Pay Date</th>
                <th className="px-6 py-4 text-xs font-bold font-mono text-outline uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {payouts.map((p, i) => (
                <tr 
                  key={i} 
                  className="hover:bg-surface-container-lowest transition-colors cursor-pointer group"
                  onClick={() => onSelectStock(p.ticker)}
                >
                  <td className="px-6 py-4.5">
                    <div className="flex items-center gap-3">
                      <div 
                        className="w-9 h-9 rounded text-white flex items-center justify-center font-bold text-sm tracking-wide shadow-sm border border-outline-variant/10"
                        style={{ backgroundColor: getAssetColor(p.ticker) }}
                      >
                        {p.ticker[0]}
                      </div>
                      <span className="font-bold text-primary group-hover:text-secondary transition-colors">{p.ticker}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4.5 font-bold font-mono text-primary text-sm">
                    {formatCurrency(p.amount, settings.currency)}
                  </td>
                  <td className="px-6 py-4.5 text-sm text-on-surface-variant font-mono">{p.exDate}</td>
                  <td className="px-6 py-4.5 text-sm text-on-surface-variant font-mono">{p.payDate}</td>
                  <td className="px-6 py-4.5">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase tracking-wide ${
                      p.status === "Confirmed" ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface-variant"
                    }`}>
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Add Transaction Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[100] animate-fade-in">
          <div className="bg-white border border-outline-variant rounded-2xl max-w-md w-full p-6 shadow-xl relative animate-scale-up">
            <h3 className="text-xl font-bold text-primary mb-2">Buy Asset or Add Dividend</h3>
            <p className="text-sm text-on-surface-variant mb-6">Log an asset addition or receipt for portfolio compounding simulation.</p>
            
            <form onSubmit={handleAddSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-outline uppercase tracking-wider mb-2">Transaction Type</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNewTx(prev => ({ ...prev, type: "Buy" }))}
                    className={`py-2 rounded-lg font-bold text-sm border transition-all ${
                      newTx.type === "Buy" 
                        ? "bg-primary text-on-primary border-primary" 
                        : "bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-variant"
                    }`}
                  >
                    Buy Asset
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewTx(prev => ({ ...prev, type: "Dividend" }))}
                    className={`py-2 rounded-lg font-bold text-sm border transition-all ${
                      newTx.type === "Dividend" 
                        ? "bg-secondary text-on-secondary border-secondary" 
                        : "bg-surface border-outline-variant text-on-surface-variant hover:bg-surface-variant"
                    }`}
                  >
                    Add Dividend
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-outline uppercase tracking-wider mb-2">Symbol (Ticker)</label>
                <select
                  value={newTx.asset}
                  onChange={(e) => setNewTx(prev => ({ ...prev, asset: e.target.value }))}
                  className="w-full px-4 py-2.5 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none"
                >
                  {stocks.map(s => (
                    <option key={s.symbol} value={s.symbol}>{s.symbol} - {s.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-outline uppercase tracking-wider mb-2">
                  {newTx.type === "Buy" ? "Total Amount Spent ($)" : "Dividend Payout Amount ($)"}
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  step="0.01"
                  value={newTx.amount}
                  onChange={(e) => setNewTx(prev => ({ ...prev, amount: Number(e.target.value) }))}
                  className="w-full px-4 py-2.5 bg-surface border border-outline-variant rounded-lg text-sm font-medium focus:ring-2 focus:ring-primary focus:outline-none font-mono"
                />
              </div>

              <div className="flex gap-3 justify-end pt-4 border-t border-outline-variant">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-sm font-bold bg-primary text-on-primary hover:bg-opacity-90 rounded-lg transition-transform active:scale-95"
                >
                  Submit Log
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
