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
  error?: string;
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
  url: string = DEFAULT_LOCAL_GATEWAY_URL,
): Promise<HummingbotGatewayStatus> {
  const startTime = Date.now();
  try {
    const res = await fetch(`${url}/health`, { method: "GET" });
    const latencyMs = Date.now() - startTime;
    if (res.ok) {
      const data = await res.json().catch(() => null) as {
        version?: unknown;
        activeBotsCount?: unknown;
      } | null;
      return {
        connected: true,
        gatewayUrl: url,
        version: typeof data?.version === "string" ? data.version : "not reported",
        latencyMs,
        activeBotsCount: typeof data?.activeBotsCount === "number" && Number.isFinite(data.activeBotsCount)
          ? data.activeBotsCount
          : 0,
        lastPing: new Date().toLocaleTimeString()
      };
    }
  } catch (error) {
    return {
      connected: false,
      gatewayUrl: url,
      version: "unavailable",
      latencyMs: Date.now() - startTime,
      activeBotsCount: 0,
      lastPing: new Date().toLocaleTimeString(),
      error: error instanceof Error ? error.message : "Gateway health check failed",
    };
  }

  return {
    connected: false,
    gatewayUrl: url,
    version: "unavailable",
    latencyMs: Date.now() - startTime,
    activeBotsCount: 0,
    lastPing: new Date().toLocaleTimeString(),
    error: "Gateway returned a non-success health response",
  };
}
