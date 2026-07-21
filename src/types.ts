export interface Stock {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  yield: number; // e.g. 5.82 for 5.82%
  growth5y: number; // e.g. 4.2 for 4.2%
  payoutRatio: number; // e.g. 74.2 for 74.2%
  frequency: "Monthly" | "Quarterly" | "Annual";
  historySparkline: number[];
  marketCap: string; // e.g. "47.1B"
  pAffo: string; // e.g. "13.2x"
  exDivDate: string;
  payDate: string;
  divType: string; // e.g. "Qualified"
  safetyScore: number; // e.g. 92
  safetyLabel: "Very Safe" | "Safe" | "Borderline" | "Risky";
  whyPick: string;
  rank?: string; // e.g. "01"
  dividendGrowthHistory: { year: number; payout: number }[]; // 10 years
  assetType?: "Stock" | "Crypto";
  country?: string; // e.g. "US", "UK", "CA"
  exchange?: string; // e.g. "NYSE", "LSE", "Crypto"
}

export interface Transaction {
  id: string;
  type: "Dividend" | "Buy" | "Sell";
  asset: string;
  date: string;
  amount: number;
  isIncome: boolean;
}

export interface Payout {
  ticker: string;
  amount: number;
  exDate: string;
  payDate: string;
  status: "Upcoming" | "Confirmed";
}

export interface UserSettings {
  name: string;
  email: string;
  avatarUrl: string;
  pushNotifications: boolean;
  emailAlerts: boolean;
  weeklyReports: boolean;
  compactView: boolean;
  biometricUnlock: boolean;
  isPro: boolean;
  portfolioBudget: number;
  currency: string;
}

export interface SavedStrategy {
  id: string;
  symbol: string;
  initialCapital: number;
  monthlyContribution: number;
  years: number;
  reinvestDividends: boolean;
  dateSaved: string; // ISO format
  projectedValue: number;
}

// ── Day Trading Lab ───────────────────────────────────────────────────────────

export type MarketType = "Stock" | "Options" | "Crypto";
export type SignalType = "BUY" | "SELL" | "HOLD";
export type TradeInterval = "1m" | "5m" | "15m" | "1h";

export type DayStrategy =
  | "RSI Reversal"
  | "VWAP Scalp"
  | "EMA Crossover"
  | "Opening Range Breakout"
  | "RSI + MACD"
  | "Bollinger Band Squeeze"
  | "Momentum Scalp"
  | "Bull Call Spread"
  | "Bear Put Spread"
  | "Iron Condor"
  | "Covered Call";

export interface CandleBar {
  time: number;       // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeSignal {
  type: SignalType;
  entry: number;
  target: number;
  stopLoss: number;
  riskRewardRatio: number;
  reasoning: string;
  confidence: number; // 0-100
}

export interface StrategyResult {
  signal: TradeSignal;
  indicators: Record<string, number | string>;
}

export interface OptionsGreeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  impliedVol: number;
  theoreticalPrice: number;
}

export interface DayTradePosition {
  symbol: string;
  strategy: DayStrategy;
  marketType: MarketType;
  entryPrice: number;
  size: number;         // shares / contracts / coins
  targetPrice: number;
  stopLoss: number;
  openedAt: string;     // ISO
}
