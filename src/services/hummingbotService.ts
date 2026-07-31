/**
 * Hummingbot REST Gateway Service
 * ───────────────────────────────
 * REST API client bridging Lumina Finance (TypeScript/Node) to the Hummingbot Engine (Python/Docker).
 * Default REST Gateway Endpoint: http://localhost:15888
 */

export interface HummingbotGatewayStatus {
  connected: boolean;
  gatewayUrl: string;
  version: string;
  latencyMs: number;
  activeBotsCount: number;
  lastPing: string;
}

export interface HummingbotBotStatus {
  id: string;
  name: string;
  strategyType: "CEX_DEX_ARBITRAGE" | "PURE_MARKET_MAKING" | "LIQUIDITY_MINING";
  pair: string;
  primaryExchange: string;
  secondaryExchange?: string;
  status: "RUNNING" | "STOPPED" | "STARTING" | "ERROR";
  uptimeSeconds: number;
  totalVolumeUsd: number;
  realizedPnlUsd: number;
  realizedPnlBnb: number;
  orderFillsCount: number;
  createdAt: string;
}

export const DEFAULT_LOCAL_GATEWAY_URL = "http://localhost:15888";
export const CLOUD_RUN_GATEWAY_URL = "https://hummingbot-gateway-dividendpro.run.app";

export async function checkHummingbotGatewayHealth(
  url: string = DEFAULT_LOCAL_GATEWAY_URL
): Promise<HummingbotGatewayStatus> {
  const startTime = Date.now();
  try {
    const res = await fetch(`${url}/health`, { method: "GET" });
    const latencyMs = Date.now() - startTime;
    if (res.ok) {
      return {
        connected: true,
        gatewayUrl: url,
        version: "v1.28.0-gateway",
        latencyMs,
        activeBotsCount: 2,
        lastPing: new Date().toLocaleTimeString()
      };
    }
  } catch {
    /* fallback mock health response */
  }

  return {
    connected: false,
    gatewayUrl: url,
    version: "v1.28.0-gateway (Simulated)",
    latencyMs: 14,
    activeBotsCount: 2,
    lastPing: new Date().toLocaleTimeString()
  };
}

export function getMockHummingbotBots(): HummingbotBotStatus[] {
  return [
    {
      id: "hb-bot-1",
      name: "Binance ↔ PancakeSwap Arbitrage",
      strategyType: "CEX_DEX_ARBITRAGE",
      pair: "CAKE/WBNB",
      primaryExchange: "Binance CEX",
      secondaryExchange: "PancakeSwap v2",
      status: "RUNNING",
      uptimeSeconds: 14200,
      totalVolumeUsd: 12450.00,
      realizedPnlUsd: 84.50,
      realizedPnlBnb: 0.1363,
      orderFillsCount: 48,
      createdAt: new Date(Date.now() - 14200000).toLocaleTimeString()
    },
    {
      id: "hb-bot-2",
      name: "BNB/USDT Pure Market Maker",
      strategyType: "PURE_MARKET_MAKING",
      pair: "BNB/USDT",
      primaryExchange: "Binance CEX",
      status: "RUNNING",
      uptimeSeconds: 8400,
      totalVolumeUsd: 8900.00,
      realizedPnlUsd: 42.20,
      realizedPnlBnb: 0.0680,
      orderFillsCount: 31,
      createdAt: new Date(Date.now() - 8400000).toLocaleTimeString()
    }
  ];
}
