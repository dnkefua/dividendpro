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
}
