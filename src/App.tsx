import React, { useState, useEffect } from "react";
import { 
  initialStocks, 
  initialTransactions, 
  initialPayouts, 
  initialSettings 
} from "./data";
import { db, auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from "./firebase";
import { collection, onSnapshot, doc, setDoc } from "firebase/firestore";
import { Stock, Transaction, Payout, UserSettings, SavedStrategy } from "./types";
import { authenticatedApiFetch } from "./services/authenticatedApi";
import PortfolioView from "./components/PortfolioView";
import ScannerView from "./components/ScannerView";
import AnalysisView from "./components/AnalysisView";
import Top10View from "./components/Top10View";
import ProfileView from "./components/ProfileView";
import StudioView from "./components/StudioView";
import { 
  TrendingUp, 
  Layers, 
  Search, 
  Award, 
  Settings, 
  Bell, 
  ChevronRight, 
  Bot, 
  X, 
  Send, 
  Check, 
  User, 
  Activity,
  AlertCircle,
  Sparkles,
  Link,
  BarChart2,
  Zap,
  Menu,
  Sun,
  Moon
} from "lucide-react";
import VibeTradingView from "./components/VibeTradingView";
import BSCWalletView from "./components/BSCWalletView";
import StrategyLabView from "./components/StrategyLabView";
import QuantAlphaHub from "./components/QuantAlphaHub";
import HummingbotView from "./components/HummingbotView";
import Lumina3DLogo from "./components/Lumina3DLogo";
import CommandPalette from "./components/CommandPalette";
import DripSimulatorModal from "./components/DripSimulatorModal";
import OnboardingWizard from "./components/OnboardingWizard";
import PricingModal from "./components/PricingModal";

export default function App() {
  const [activeView, setActiveView] = useState<"Portfolio" | "Scanner" | "Analysis" | "Top10" | "Settings" | "Studio" | "Vibe" | "BSC" | "StrategyLab" | "AlphaHub" | "Hummingbot">("Portfolio");
  const [signInError, setSignInError] = useState<string | null>(null);
  
  const [stocks, setStocks] = useState<Stock[]>(() => {
    const saved = localStorage.getItem("divpro_stocks");
    if (saved) {
      const parsed = JSON.parse(saved);
      // Ensure all predefined initialStocks are included and up-to-date
      const merged = [...initialStocks];
      // Add any custom stocks the user created that aren't in initialStocks
      parsed.forEach((p: Stock) => {
        if (!merged.find(m => m.symbol === p.symbol)) {
          merged.push(p);
        }
      });
      return merged;
    }
    return initialStocks;
  });

  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem("divpro_transactions");
    return saved ? JSON.parse(saved) : initialTransactions;
  });

  const [payouts, setPayouts] = useState<Payout[]>(() => {
    const saved = localStorage.getItem("divpro_payouts");
    return saved ? JSON.parse(saved) : initialPayouts;
  });

  const [settings, setSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem("divpro_settings");
    if (!saved) return initialSettings;
    try {
      const parsed = JSON.parse(saved) as UserSettings & { geminiApiKey?: unknown; alchemyApiKey?: unknown };
      delete parsed.geminiApiKey;
      delete parsed.alchemyApiKey;
      return { ...initialSettings, ...parsed, tier: parsed.tier || (parsed.isPro ? "pro" : "free") };
    } catch {
      return initialSettings;
    }
  });

  const [savedStrategies, setSavedStrategies] = useState<SavedStrategy[]>(() => {
    const saved = localStorage.getItem("divpro_strategies");
    return saved ? JSON.parse(saved) : [];
  });

  const [watchlist, setWatchlist] = useState<string[]>(() => {
    const saved = localStorage.getItem("divpro_watchlist");
    return saved ? JSON.parse(saved) : ["O", "AVGO", "PEP"];
  });

  const [selectedStockSymbol, setSelectedStockSymbol] = useState<string>("O");

  // Theme Mode State (Dark Obsidian vs Clean White)
  const [themeMode, setThemeMode] = useState<"dark" | "light">(() => {
    const saved = localStorage.getItem("divpro_theme_mode");
    return (saved as "dark" | "light") || "dark";
  });

  const toggleTheme = () => {
    const next = themeMode === "dark" ? "light" : "dark";
    setThemeMode(next);
    localStorage.setItem("divpro_theme_mode", next);
  };

  // Firebase Auth State
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      if (user) {
        localStorage.setItem("divpro_user_id", user.uid);
      } else {
        localStorage.removeItem("divpro_user_id");
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Poison the credential slot used by legacy clients. Older releases read
    // this value before every 22-second browser-to-Telegram dispatch; removing
    // it would make those clients fall back to their historically embedded
    // token, while an invalid non-empty value fails closed.
    localStorage.setItem("divpro_tg_token", "CLIENT_TELEGRAM_DISPATCH_REVOKED");
    localStorage.removeItem("divpro_tg_chat_id");
    localStorage.removeItem("divpro_txn_counter");
    localStorage.removeItem("divpro_total_profit_usd");
    localStorage.removeItem("divpro_total_profit_bnb");
  }, []);

  // Firebase surfaces sign-in failures as codes that mean nothing to a user, and
  // several of them are configuration faults rather than anything the user did
  // wrong. Silently logging to the console meant a misconfigured project looked
  // identical to a mistyped password: the button simply did nothing.
  const describeSignInError = (err: unknown): string => {
    const code = (err as { code?: string })?.code || "";
    const projectId = auth.app.options.projectId || "unknown";
    switch (code) {
      // Always name the project. These two codes are indistinguishable from
      // "provider disabled", but they also fire when the app is pointed at a
      // different project than the one that was configured — and without the
      // project ID on screen that looks identical to a console change not
      // having taken effect.
      case "auth/configuration-not-found":
      case "auth/operation-not-allowed":
        return `Google sign-in is not enabled on Firebase project "${projectId}". Enable Authentication → Sign-in method → Google for that exact project — check the project selector, not just that it is enabled somewhere.`;
      case "auth/unauthorized-domain":
        return `${window.location.hostname} is not an authorised domain on Firebase project "${projectId}".`;
      case "auth/popup-blocked":
        return "Your browser blocked the sign-in popup. Allow popups for this site and try again.";
      case "auth/popup-closed-by-user":
      case "auth/cancelled-popup-request":
        return "Sign-in was cancelled before it completed.";
      case "auth/network-request-failed":
        return "Network error reaching Firebase. Check your connection and try again.";
      default:
        return code
          ? `Sign-in failed (${code}).`
          : "Sign-in failed for an unknown reason. See the browser console for details.";
    }
  };

  const handleGoogleSignIn = async () => {
    setSignInError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Google Sign-In Error:", err);
      setSignInError(describeSignInError(err));
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Sign-Out Error:", err);
    }
  };

  // Notifications bell dropdown
  const [showNotifications, setShowNotifications] = useState(false);
  const [systemNotifications, setSystemNotifications] = useState([
    { id: 1, title: "Dividend Received: AAPL", desc: "+$142.50 was successfully deposited.", time: "Today, 10:42 AM", unread: true },
    { id: 2, title: "Upcoming Ex-Date: Realty Income (O)", desc: "Ex-Date scheduled for Oct 31, 2024. Confirm holdings.", time: "Yesterday", unread: false },
    { id: 3, title: "Yield Change: GNL", desc: "Global Net Lease yield updated to 9.30% after recent valuation cycle.", time: "2 days ago", unread: false }
  ]);

  // AI Chat Assistant Drawer
  const [isAiDrawerOpen, setIsAiDrawerOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<{ sender: "user" | "bot"; text: string }[]>([
    { sender: "bot", text: "Hello! I am your Lumina Finance DividendPro AI Assistant. Ask me anything about compound yield modeling, dividend traps, or specific stocks in our database." }
  ]);
  const [currentChatInput, setCurrentChatInput] = useState("");
  const [isSendingToChat, setIsSendingToChat] = useState(false);

  // New Production UX Modals
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isDripSimulatorOpen, setIsDripSimulatorOpen] = useState(false);
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() => !localStorage.getItem("divpro_onboarded"));

  // Sync state to localStorage
  useEffect(() => {
    localStorage.setItem("divpro_stocks", JSON.stringify(stocks));
  }, [stocks]);

  useEffect(() => {
    localStorage.setItem("divpro_transactions", JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem("divpro_payouts", JSON.stringify(payouts));
  }, [payouts]);

  useEffect(() => {
    localStorage.setItem("divpro_settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem("divpro_watchlist", JSON.stringify(watchlist));
  }, [watchlist]);

  useEffect(() => {
    localStorage.setItem("divpro_strategies", JSON.stringify(savedStrategies));
  }, [savedStrategies]);

  // Sync Transactions & Watchlist with Firebase Firestore
  useEffect(() => {
    if (!authUser) return;
    try {
      const unsubTransactions = onSnapshot(collection(db, "users", authUser.uid, "transactions"), (snapshot) => {
        const list: Transaction[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...doc.data() } as Transaction);
        });
        if (list.length > 0) {
          setTransactions(list);
        }
      }, (error) => {
        console.warn("Firestore sync failed or database offline, falling back to localStorage:", error);
      });

      const unsubWatchlist = onSnapshot(doc(db, "users", authUser.uid, "settings", "watchlist"), (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data && Array.isArray(data.items)) {
            setWatchlist(data.items);
          }
        }
      }, (error) => {
        console.warn("Firestore watchlist sync failed, falling back to localStorage:", error);
      });

      return () => {
        unsubTransactions();
        unsubWatchlist();
      };
    } catch (e) {
      console.warn("Firebase Firestore could not be initialized:", e);
    }
  }, [authUser]);

  const activeStock = stocks.find(s => s.symbol === selectedStockSymbol) || stocks[0];

  // Handler functions
  const handleAddTransaction = async (newTx: Omit<Transaction, "id">) => {
    const txId = `tx-${Date.now()}`;
    const tx: Transaction = {
      ...newTx,
      id: txId
    };
    const updated = [tx, ...transactions];
    setTransactions(updated);

    // Save to Firestore
    try {
      if (!authUser) throw new Error("Sign in to synchronize transactions.");
      await setDoc(doc(db, "users", authUser.uid, "transactions", txId), {
        type: tx.type,
        asset: tx.asset,
        date: tx.date,
        amount: tx.amount,
        isIncome: tx.isIncome
      });
    } catch (e) {
      console.warn("Failed to write transaction to Firestore:", e);
    }

    // Add notification
    setSystemNotifications(prev => [
      {
        id: prev.length + 1,
        title: tx.type === "Buy" ? `Asset Purchased: ${tx.asset}` : `Dividend Received: ${tx.asset}`,
        desc: tx.type === "Buy" ? `Bought asset worth $${tx.amount.toLocaleString()}.` : `Deposited dividend income of $${tx.amount.toFixed(2)}.`,
        time: "Just Now",
        unread: true
      },
      ...prev
    ]);
  };

  const handleAddCustomStock = (newStock: Stock) => {
    setStocks(prev => [newStock, ...prev]);
  };

  const handleUpdateSettings = (newSettings: UserSettings) => {
    setSettings(newSettings);
  };

  const handleSaveStrategy = (strategy: SavedStrategy) => {
    setSavedStrategies(prev => [strategy, ...prev]);
  };

  const handleDeleteStrategy = (id: string) => {
    setSavedStrategies(prev => prev.filter(s => s.id !== id));
  };

  const handleToggleWatchlist = async (symbol: string) => {
    const nextWatchlist = watchlist.includes(symbol)
      ? watchlist.filter(s => s !== symbol)
      : [...watchlist, symbol];

    setWatchlist(nextWatchlist);

    // Save to Firestore
    try {
      if (!authUser) throw new Error("Sign in to synchronize your watchlist.");
      await setDoc(doc(db, "users", authUser.uid, "settings", "watchlist"), {
        items: nextWatchlist
      });
    } catch (e) {
      console.warn("Failed to write watchlist to Firestore:", e);
    }
  };

  const handleSelectStock = (symbol: string) => {
    setSelectedStockSymbol(symbol);
    setActiveView("Analysis");
  };

  const handleOpenAiAssistant = (initialPrompt?: string) => {
    setIsAiDrawerOpen(true);
    if (initialPrompt) {
      handleSendChatMessage(initialPrompt);
    }
  };

  const handleSendChatMessage = async (textToSend?: string) => {
    const prompt = textToSend || currentChatInput;
    if (!prompt.trim()) return;

    // Add user message immediately
    setChatMessages(prev => [...prev, { sender: "user", text: prompt }]);
    if (!textToSend) setCurrentChatInput("");
    setIsSendingToChat(true);

    try {
      const response = await authenticatedApiFetch("/api/gemini/chat", {
        method: "POST",
        body: JSON.stringify({ message: prompt })
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to reach AI server.");
      }
      const data = await response.json();
      const replyText = data.text || "";

      setChatMessages(prev => [...prev, { sender: "bot", text: replyText }]);
    } catch (err: any) {
      console.error(err);
      setChatMessages(prev => [...prev, {
        sender: "bot",
        text: `Connection failed: ${err.message || err}. Sign in and verify the server-side AI configuration.`
      }]);
    } finally {
      setIsSendingToChat(false);
    }
  };

  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const handleMarkNotificationsRead = () => {
    setSystemNotifications(prev => prev.map(n => ({ ...n, unread: false })));
  };

  return (
    <div className={`min-h-screen ${themeMode === "dark" ? "bg-[#030712] text-slate-100" : "bg-[#f8fafc] text-slate-900"} flex font-sans relative ${settings.compactView ? "text-xs" : "text-sm"}`} id="app-viewport">
      
      {/* Mobile Drawer Overlay */}
      {isMobileNavOpen && (
        <div 
          onClick={() => setIsMobileNavOpen(false)}
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 md:hidden"
        />
      )}

      {/* Aurix Glass Left Sidebar Navigation */}
      <aside className={`fixed md:sticky top-0 h-screen w-64 ${
        themeMode === "dark" ? "bg-[#090d16]/95 border-white/10" : "bg-white/95 border-slate-200 shadow-xl"
      } backdrop-blur-2xl border-r flex flex-col justify-between z-50 transition-transform duration-300 ${
        isMobileNavOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}>
        <div className="p-4 space-y-6 overflow-y-auto">
          
          {/* Logo Brand Title */}
          <div className="px-2 py-2 border-b border-white/10 pb-4 cursor-pointer" onClick={() => { setActiveView("AlphaHub"); setIsMobileNavOpen(false); }}>
            <Lumina3DLogo size={38} showText={true} />
          </div>

          <div>
            <div className="px-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">📊 PORTFOLIO</div>
            <div className="space-y-1">
              {[
                { id: "Portfolio", label: "Portfolio Vault", icon: Layers },
                { id: "Scanner", label: "Market Scanner", icon: Search },
                { id: "Analysis", label: "Analysis", icon: TrendingUp },
                { id: "Top10", label: "Top 10 Rankings", icon: Award }
              ].map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setActiveView(item.id as any); setIsMobileNavOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-extrabold transition-all ${
                      activeView === item.id 
                        ? "bg-white/10 border border-emerald-500/50 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]" 
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="px-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">⚡ TRADING & AI</div>
            <div className="space-y-1">
              {[
                { id: "Vibe", label: "Vibe AI Swarm", icon: Sparkles },
                { id: "StrategyLab", label: "Strategy Lab", icon: BarChart2 },
                { id: "Studio", label: "Quant Studio", icon: Activity }
              ].map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setActiveView(item.id as any); setIsMobileNavOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-extrabold transition-all ${
                      activeView === item.id 
                        ? "bg-white/10 border border-emerald-500/50 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]" 
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="px-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">🔬 RESEARCH</div>
            <div className="space-y-1">
              {[
                { id: "AlphaHub", label: "MEV Research", icon: Zap },
                { id: "BSC", label: "BSC Wallet", icon: Link },
                { id: "Hummingbot", label: "Hummingbot", icon: Bot }
              ].map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setActiveView(item.id as any); setIsMobileNavOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-extrabold transition-all ${
                      activeView === item.id 
                        ? "bg-white/10 border border-emerald-500/50 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]" 
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="px-3 text-[10px] font-extrabold text-slate-500 uppercase tracking-widest mb-2">⚙️ SETTINGS</div>
            <div className="space-y-1">
              {[
                { id: "Settings", label: "Settings", icon: Settings }
              ].map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setActiveView(item.id as any); setIsMobileNavOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-extrabold transition-all ${
                      activeView === item.id 
                        ? "bg-white/10 border border-emerald-500/50 text-white shadow-[0_0_15px_rgba(16,185,129,0.3)]" 
                        : "text-slate-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        {/* Bottom User Profile Badge */}
        <div className="p-4 border-t border-white/10 flex items-center justify-between">
          <div 
            onClick={() => setActiveView("Settings")}
            className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition"
          >
            <img 
              alt="Avatar" 
              className="w-9 h-9 rounded-full border border-emerald-500/50 object-cover"
              src={settings.avatarUrl}
            />
            <div>
              <p className="text-xs font-bold text-slate-200">{settings.name}</p>
              <p className="text-[10px] font-extrabold text-emerald-400">{settings.tier === "institutional" ? "INSTITUTIONAL" : settings.tier === "pro" ? "PRO MEMBER" : "STARTER"}</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Body Container */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* Minimal Clean Top Header Bar */}
        <header className={`sticky top-0 ${
          themeMode === "dark" ? "bg-[#030712]/85 border-white/10" : "bg-white/85 border-slate-200 shadow-xs text-slate-900"
        } backdrop-blur-xl border-b z-40 h-16 px-4 md:px-8 flex items-center justify-between`}>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsMobileNavOpen(!isMobileNavOpen)} 
              className="md:hidden p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10"
            >
              <Menu className="w-5 h-5" />
            </button>

            <span className="text-xs font-extrabold text-slate-400">
              DividendPro / <strong className="text-white text-sm">{
                activeView === "AlphaHub" ? "MEV Research" :
                activeView === "BSC" ? "BSC Wallet" :
                activeView === "Vibe" ? "Vibe AI Swarm" :
                activeView === "StrategyLab" ? "Strategy Lab" :
                activeView === "Studio" ? "Quant Studio" :
                activeView === "Hummingbot" ? "Hummingbot" :
                activeView
              }</strong>
            </span>
          </div>

          {/* Right Action Icons Group */}
          {/* `relative` anchors the sign-in error toast, which is positioned
              against this row rather than the page. */}
          <div className="relative flex items-center gap-3">

            {/* 1-Click Theme Switcher Button */}
            <button
              onClick={toggleTheme}
              className={`px-3 py-1.5 rounded-xl border font-extrabold text-xs flex items-center gap-1.5 transition-all ${
                themeMode === "dark" 
                  ? "bg-white/10 border-white/10 text-amber-300 hover:bg-white/20" 
                  : "bg-slate-200 border-slate-300 text-slate-900 hover:bg-slate-300"
              }`}
              title="Toggle Light / Dark Theme"
            >
              {themeMode === "dark" ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-indigo-600" />}
              <span>{themeMode === "dark" ? "☀️ Light" : "🌙 Dark"}</span>
            </button>

            {/* Search Command Palette Trigger */}
            <button
              onClick={() => setIsCommandPaletteOpen(true)}
              className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-xs font-medium transition"
            >
              <Search className="w-3.5 h-3.5 text-indigo-400" />
              <span>Search...</span>
              <kbd className="px-1.5 py-0.5 bg-white/10 rounded border border-white/20 font-mono text-[10px] text-slate-400">⌘K</kbd>
            </button>

            {/* DRIP Freedom Calculator Quick Action */}
            <button
              onClick={() => setIsDripSimulatorOpen(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 font-bold text-xs border border-emerald-500/20 transition"
              title="FIRE & DRIP Calculator"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>DRIP Calc</span>
            </button>

            {/* Upgrade Plan Tier Trigger */}
            <button
              onClick={() => setIsPricingOpen(true)}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold text-xs hover:brightness-110 shadow-xs transition"
            >
              <span>PRO</span>
            </button>

            {/* Google Firebase Authentication */}
            {authUser ? (
              <div className="flex items-center gap-2 bg-[#0f172a] border border-emerald-500/30 px-3 py-1.5 rounded-xl">
                {authUser.photoURL ? (
                  <img src={authUser.photoURL} alt={authUser.displayName || "User"} className="w-5 h-5 rounded-full border border-emerald-400" />
                ) : (
                  <User className="w-4 h-4 text-emerald-400" />
                )}
                <span className="text-xs font-bold text-white hidden md:inline">{authUser.displayName?.split(" ")[0] || authUser.email?.split("@")[0]}</span>
                <button 
                  onClick={handleSignOut}
                  className="text-slate-400 hover:text-white text-[11px] font-bold ml-1 transition"
                  title="Sign Out of Firebase Account"
                >
                  Sign Out
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleSignIn}
                className="bg-white hover:bg-slate-100 text-slate-900 px-3.5 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-sm transition-all"
                title="Sign in with Google Account to sync yield session"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
                <span>Google Sign In</span>
              </button>
            )}
            {signInError && (
              <div
                role="alert"
                className="absolute right-0 top-full mt-2 z-50 max-w-xs rounded-xl border border-red-500/40 bg-red-950/95 px-3 py-2 text-[11px] font-semibold leading-snug text-red-100 shadow-lg"
              >
                {signInError}
                <button
                  onClick={() => setSignInError(null)}
                  className="mt-1.5 block text-[10px] font-black uppercase tracking-wide text-red-300 hover:text-red-100"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* AI Floating Trigger Quick Action */}
            <button 
              onClick={() => setIsAiDrawerOpen(true)}
              className="bg-white/10 text-slate-200 hover:bg-white/20 p-2 rounded-full transition-all duration-200 relative"
              title="Lumina AI Analyst Chatbot"
            >
              <Bot className="w-5 h-5 text-emerald-400" />
              <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse"></span>
            </button>

            {/* Notification Bell Dropdown Button */}
            <div className="relative">
              <button 
                onClick={() => {
                  setShowNotifications(!showNotifications);
                  if (!showNotifications) handleMarkNotificationsRead();
                }}
                className="p-2.5 rounded-full hover:bg-white/10 text-slate-200 transition-all relative"
                title="System alerts"
              >
                <Bell className="w-5 h-5" />
                {systemNotifications.some(n => n.unread) && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-400 rounded-full"></span>
                )}
              </button>

              {/* Notification Box Dropdown */}
              {showNotifications && (
                <div className="absolute right-0 mt-3 w-80 bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl z-50 p-4 animate-scale-up">
                  <div className="flex justify-between items-center pb-2 border-b border-white/10 mb-3">
                    <span className="font-bold text-white">Recent Notifications</span>
                    <button 
                      onClick={() => setShowNotifications(false)}
                      className="text-slate-400 hover:text-white text-xs font-semibold"
                    >
                      Close
                    </button>
                  </div>
                  <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                    {systemNotifications.map((notif) => (
                      <div key={notif.id} className="p-2.5 rounded-xl bg-slate-900 border border-white/5 hover:border-white/20 transition-all">
                        <div className="flex justify-between items-start gap-1">
                          <p className="text-xs font-bold text-white leading-tight">{notif.title}</p>
                          {notif.unread && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 mt-1"></span>}
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed mt-1">{notif.desc}</p>
                        <p className="text-[9px] text-slate-500 font-mono mt-1">{notif.time}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

      {/* Main Body Content with Layout Constraints */}
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 md:px-8 py-8 pb-24 md:pb-12">
        {activeView === "AlphaHub" && (
          <QuantAlphaHub authUser={authUser} />
        )}
        {activeView === "Hummingbot" && (
          <HummingbotView />
        )}
        {activeView === "Portfolio" && (
          <PortfolioView 
            stocks={stocks}
            transactions={transactions}
            payouts={payouts}
            onAddTransaction={handleAddTransaction}
            onSelectStock={handleSelectStock}
            isPro={settings.isPro}
            onOpenAiAssistant={handleOpenAiAssistant}
            settings={settings}
          />
        )}
        {activeView === "Scanner" && (
          <ScannerView 
            stocks={stocks}
            onSelectStock={handleSelectStock}
            isPro={settings.isPro}
            onOpenAiAssistant={handleOpenAiAssistant}
            onAddCustomStock={handleAddCustomStock}
            settings={settings}
          />
        )}
        {activeView === "Analysis" && (
          <AnalysisView 
            stock={activeStock}
            isPro={settings.isPro}
            onAddTransaction={handleAddTransaction}
            onAddWatchlist={handleToggleWatchlist}
            isWatched={watchlist.includes(activeStock.symbol)}
            settings={settings}
          />
        )}
        {activeView === "Top10" && (
          <Top10View 
            stocks={stocks}
            onSelectStock={handleSelectStock}
            isPro={settings.isPro}
            onOpenAiAssistant={handleOpenAiAssistant}
            onAddCustomStock={handleAddCustomStock}
            settings={settings}
          />
        )}
        {activeView === "Settings" && (
          <ProfileView 
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
          />
        )}
        {activeView === "Studio" && (
          <StudioView 
            stocks={stocks}
            settings={settings}
            savedStrategies={savedStrategies}
            onSaveStrategy={handleSaveStrategy}
            onDeleteStrategy={handleDeleteStrategy}
          />
        )}
        {activeView === "Vibe" && (
          <VibeTradingView 
            stocks={stocks}
            transactions={transactions}
            settings={settings}
          />
        )}
        {activeView === "BSC" && (
          <BSCWalletView />
        )}
        {activeView === "StrategyLab" && (
          <StrategyLabView />
        )}
      </main>
      </div>

      {/* Mobile Sticky Bottom Navigation Bar */}
      <footer className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-outline-variant py-2 px-3 z-50 flex justify-around shadow-lg" id="mobile-nav-bar">
        {[
          { id: "Portfolio", label: "Portfolio", icon: Layers },
          { id: "Scanner", label: "Scanner", icon: Search },
          { id: "Analysis", label: "Analysis", icon: TrendingUp },
          { id: "Top10", label: "Top 10", icon: Award },
          { id: "Settings", label: "Settings", icon: Settings }
        ].map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id as any)}
              className={`flex flex-col items-center gap-1 p-1 text-[10px] font-bold ${
                activeView === item.id 
                  ? "text-secondary font-extrabold" 
                  : "text-on-surface-variant hover:text-primary"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </footer>

      {/* Interactive Global AI Chat Assistant Drawer */}
      {isAiDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex justify-end animate-fade-in" id="ai-drawer-backdrop">
          <div className="bg-[#090d16] border-l border-emerald-500/30 max-w-lg w-full h-full flex flex-col shadow-2xl relative animate-slide-left">
            
            {/* Drawer Header */}
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-[#0f172a]">
              <div className="flex items-center gap-2.5">
                <div className="bg-emerald-500 p-2 rounded-xl text-black">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Lumina Dividend AI Analyst</h3>
                  <p className="text-[11px] text-emerald-400 font-semibold mt-0.5">Dividend safety analysis, yield research & compound projections</p>
                </div>
              </div>
              <button 
                onClick={() => setIsAiDrawerOpen(false)}
                className="p-2 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Chat History Messages */}
            <div className="flex-grow overflow-y-auto p-6 space-y-4 bg-[#090d16]" id="chat-messages-container">
              {chatMessages.map((msg, idx) => (
                <div 
                  key={idx} 
                  className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm text-sm leading-relaxed ${
                    msg.sender === "user" 
                      ? "bg-gradient-to-r from-emerald-600 to-teal-600 text-white rounded-tr-none font-medium" 
                      : "bg-[#0f172a] text-slate-100 border border-white/10 rounded-tl-none whitespace-pre-wrap"
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}

              {isSendingToChat && (
                <div className="flex justify-start">
                  <div className="bg-[#0f172a] text-slate-200 border border-white/10 rounded-2xl rounded-tl-none p-4 max-w-[85%] flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
                    <span className="text-xs font-mono font-bold animate-pulse text-emerald-400">Lumina AI is computing yields...</span>
                  </div>
                </div>
              )}
            </div>

            {/* Quick Suggestion Questions */}
            <div className="px-6 py-3 bg-[#0f172a] border-t border-white/10 flex gap-2 overflow-x-auto whitespace-nowrap scrollbar-none">
              {[
                { label: "Is AVGO safe?", q: "What is the dividend safety of Broadcom (AVGO) given its current payout ratio and free cash flow?" },
                { label: "High yield trap?", q: "Is Global Net Lease (GNL) with its 9.30% yield a dividend trap? Analyze the payout sustainability." },
                { label: "DRIP projection", q: "If I invest $2,000/month in Realty Income (O) at 5.64% yield with DRIP, what's my projected monthly income in 15 years?" }
              ].map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSendChatMessage(s.q)}
                  className="bg-[#1e293b] border border-white/10 rounded-full px-3.5 py-1.5 text-xs text-slate-300 hover:text-emerald-400 hover:border-emerald-500 transition-colors font-semibold shadow-sm shrink-0"
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Drawer Chat Input Form */}
            <div className="p-4 border-t border-white/10 bg-[#0f172a]">
              <form 
                onSubmit={(e) => { e.preventDefault(); handleSendChatMessage(); }}
                className="flex gap-2"
              >
                <input 
                  type="text" 
                  value={currentChatInput}
                  onChange={(e) => setCurrentChatInput(e.target.value)}
                  placeholder="Ask about dividend safety, yields, or compound growth..."
                  className="flex-grow px-4 py-3 border border-white/15 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 text-white placeholder-slate-500 font-medium bg-[#090d16]"
                />
                <button 
                  type="submit"
                  disabled={isSendingToChat || !currentChatInput.trim()}
                  className="bg-emerald-500 text-black font-black px-5 py-3 rounded-xl flex items-center justify-center transition-all hover:bg-emerald-400 disabled:opacity-50 active:scale-95 shadow-sm"
                >
                  <Send className="w-4.5 h-4.5" />
                </button>
              </form>
            </div>

          </div>
        </div>
      )}

      {/* Production UX Modals */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectView={(view) => setActiveView(view)}
        onOpenAiDrawer={() => setIsAiDrawerOpen(true)}
        onOpenDripSimulator={() => setIsDripSimulatorOpen(true)}
        onOpenPricing={() => setIsPricingOpen(true)}
        onSelectStock={(sym) => handleSelectStock(sym)}
      />

      <DripSimulatorModal
        isOpen={isDripSimulatorOpen}
        onClose={() => setIsDripSimulatorOpen(false)}
      />

      <OnboardingWizard
        isOpen={isOnboardingOpen}
        onClose={() => {
          localStorage.setItem("divpro_onboarded", "true");
          setIsOnboardingOpen(false);
        }}
        onSelectPersona={(persona) => {
          if (persona === "trading") setActiveView("Vibe");
          else if (persona === "research") setActiveView("BSC");
          else setActiveView("Portfolio");
        }}
      />

      <PricingModal
        isOpen={isPricingOpen}
        onClose={() => setIsPricingOpen(false)}
        currentTier={settings.tier || (settings.isPro ? "pro" : "free")}
      />

    </div>
  );
}
