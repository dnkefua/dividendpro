import React, { useState, useEffect } from "react";
import { Search, TrendingUp, Layers, Bot, Activity, DollarSign, Award, Settings, Zap, ArrowRight, ShieldCheck } from "lucide-react";
import { initialStocks } from "../data";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectView: (view: any) => void;
  onOpenAiDrawer: () => void;
  onOpenDripSimulator: () => void;
  onOpenPricing: () => void;
  onSelectStock: (symbol: string) => void;
}

export default function CommandPalette({
  isOpen,
  onClose,
  onSelectView,
  onOpenAiDrawer,
  onOpenDripSimulator,
  onOpenPricing,
  onSelectStock
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery("");
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const views = [
    { name: "Portfolio", key: "Portfolio", icon: Layers, desc: "Track dividend yield & holding breakdown" },
    { name: "Scanner", key: "Scanner", icon: Search, desc: "Screen high-yield equities & crypto staking" },
    { name: "Analysis", key: "Analysis", icon: Activity, desc: "AI-powered safety score & fundamental audit" },
    { name: "Strategy Lab", key: "StrategyLab", icon: Zap, desc: "Options covered calls & cash-secured puts" },
    { name: "Vibe Trading Lab", key: "Vibe", icon: Bot, desc: "Investment committee AI agent swarm" },
    { name: "BSC Sniper Bot", key: "BSC", icon: ShieldCheck, desc: "Mempool token sniper & liquidity tracker" },
    { name: "Top 10 Picks", key: "Top10", icon: Award, desc: "Curated high-safety dividend champions" },
    { name: "Settings", key: "Settings", icon: Settings, desc: "Manage preferences & API configurations" },
  ];

  const filteredViews = views.filter(v => v.name.toLowerCase().includes(query.toLowerCase()) || v.desc.toLowerCase().includes(query.toLowerCase()));
  const filteredStocks = initialStocks.filter(s => s.symbol.toLowerCase().includes(query.toLowerCase()) || s.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-slate-950/80 backdrop-blur-md animate-fade-in" onClick={onClose}>
      <div 
        className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden glass-panel"
        onClick={e => e.stopPropagation()}
      >
        {/* Input Header */}
        <div className="flex items-center px-4 py-3.5 border-b border-slate-800 bg-slate-950/50">
          <Search className="w-5 h-5 text-indigo-400 mr-3 shrink-0" />
          <input
            type="text"
            autoFocus
            placeholder="Type a command, stock symbol (e.g., AAPL), or view..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full bg-transparent text-slate-100 placeholder-slate-500 outline-none text-base font-medium"
          />
          <kbd className="px-2 py-1 bg-slate-800 border border-slate-700 text-slate-400 text-xs rounded font-mono shrink-0 ml-2">ESC</kbd>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2 space-y-4">
          {/* Quick Actions */}
          <div>
            <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Quick Actions</div>
            <div className="grid grid-cols-2 gap-1.5 mt-1">
              <button
                onClick={() => { onOpenDripSimulator(); onClose(); }}
                className="flex items-center space-x-3 p-2.5 rounded-xl hover:bg-slate-800/70 text-left transition group"
              >
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500/20">
                  <DollarSign className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-200">DRIP Calculator</div>
                  <div className="text-xs text-slate-400">Simulate FIRE & yield compounding</div>
                </div>
              </button>

              <button
                onClick={() => { onOpenAiDrawer(); onClose(); }}
                className="flex items-center space-x-3 p-2.5 rounded-xl hover:bg-slate-800/70 text-left transition group"
              >
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 group-hover:bg-purple-500/20">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-200">AI Assistant</div>
                  <div className="text-xs text-slate-400">Ask Gemini portfolio questions</div>
                </div>
              </button>
            </div>
          </div>

          {/* Navigation Views */}
          {filteredViews.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Navigation</div>
              <div className="space-y-1 mt-1">
                {filteredViews.map((view) => {
                  const Icon = view.icon;
                  return (
                    <button
                      key={view.key}
                      onClick={() => { onSelectView(view.key); onClose(); }}
                      className="w-full flex items-center justify-between p-2.5 rounded-xl hover:bg-slate-800/70 text-left transition group"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="p-2 rounded-lg bg-slate-800 text-slate-300 group-hover:bg-indigo-600/20 group-hover:text-indigo-400">
                          <Icon className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-200">{view.name}</div>
                          <div className="text-xs text-slate-400">{view.desc}</div>
                        </div>
                      </div>
                      <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-slate-300 group-hover:translate-x-0.5 transition" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stock Tickers */}
          {filteredStocks.length > 0 && (
            <div>
              <div className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-slate-500">Stock Assets</div>
              <div className="grid grid-cols-2 gap-1.5 mt-1">
                {filteredStocks.slice(0, 6).map((stock) => (
                  <button
                    key={stock.symbol}
                    onClick={() => {
                      onSelectStock(stock.symbol);
                      onSelectView("Analysis");
                      onClose();
                    }}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/40 hover:bg-slate-800/70 text-left border border-slate-800/50 transition group"
                  >
                    <div className="flex items-center space-x-2.5">
                      <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 font-mono font-bold text-xs">
                        {stock.symbol}
                      </span>
                      <span className="text-xs text-slate-300 truncate max-w-[120px] font-medium">
                        {stock.name}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-emerald-400 font-mono">
                      {stock.yield}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs text-slate-500">
          <span>Tip: Use <kbd className="px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded font-mono">⌘K</kbd> anywhere to open</span>
          <button 
            onClick={() => { onOpenPricing(); onClose(); }}
            className="text-indigo-400 hover:text-indigo-300 font-medium"
          >
            Upgrade Plan →
          </button>
        </div>
      </div>
    </div>
  );
}
