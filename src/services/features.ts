import { UserSettings } from "../types";

export type Feature =
  | "ai_analysis"
  | "ai_unlimited"
  | "options_chain"
  | "backtesting"
  | "drip_calculator"
  | "crypto_yield"
  | "macro_overlay"
  | "vibe_debate"
  | "bsc_wallet"
  | "mev_dashboard"
  | "api_access"
  | "bulk_screening"
  | "webhook_alerts";

const TIER_FEATURES: Record<string, Feature[]> = {
  free: [
    "ai_analysis",
    "drip_calculator",
  ],
  pro: [
    "ai_analysis",
    "ai_unlimited",
    "options_chain",
    "backtesting",
    "drip_calculator",
    "crypto_yield",
    "macro_overlay",
    "vibe_debate",
  ],
  institutional: [
    "ai_analysis",
    "ai_unlimited",
    "options_chain",
    "backtesting",
    "drip_calculator",
    "crypto_yield",
    "macro_overlay",
    "vibe_debate",
    "bsc_wallet",
    "mev_dashboard",
    "api_access",
    "bulk_screening",
    "webhook_alerts",
  ],
};

export function hasFeature(settings: UserSettings, feature: Feature): boolean {
  const tier = settings.tier || (settings.isPro ? "pro" : "free");
  return (TIER_FEATURES[tier] || TIER_FEATURES.free).includes(feature);
}

export function getTierName(settings: UserSettings): string {
  const tier = settings.tier || (settings.isPro ? "pro" : "free");
  return tier === "institutional" ? "Institutional" : tier === "pro" ? "Pro" : "Starter";
}

export const FEATURE_LABELS: Record<Feature, string> = {
  ai_analysis: "AI Stock Analysis (5/month)",
  ai_unlimited: "Unlimited AI Analysis",
  options_chain: "Options Chain Data",
  backtesting: "Strategy Backtesting",
  drip_calculator: "DRIP Calculator",
  crypto_yield: "Crypto Yield Data",
  macro_overlay: "Macro Treasury Overlays",
  vibe_debate: "AI Strategy Swarm",
  bsc_wallet: "BSC Wallet Terminal",
  mev_dashboard: "MEV Research Dashboard",
  api_access: "REST API Access",
  bulk_screening: "Bulk Dividend Screening",
  webhook_alerts: "Webhook Price Alerts",
};