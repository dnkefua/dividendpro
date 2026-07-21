import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  ColorType,
} from "lightweight-charts";
import {
  MarketType,
  DayStrategy,
  TradeInterval,
  CandleBar,
  TradeSignal,
  StrategyResult,
  OptionsGreeks,
} from "../types";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  AlertTriangle,
  Target,
  ShieldAlert,
  Zap,
  BarChart2,
  DollarSign,
  Activity,
  ChevronDown,
  Search,
  Clock,
  Info,
  Flame,
  Loader2,
  Crown,
} from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────────

const STRATEGIES_BY_MARKET: Record<MarketType, DayStrategy[]> = {
  Stock: ["RSI Reversal", "VWAP Scalp", "EMA Crossover", "Opening Range Breakout"],
  Options: ["Bull Call Spread", "Bear Put Spread", "Iron Condor", "Covered Call"],
  Crypto: ["RSI + MACD", "Bollinger Band Squeeze", "Momentum Scalp"],
};

const STRATEGY_DESC: Record<DayStrategy, string> = {
  "RSI Reversal":           "Buy oversold (RSI<30), sell overbought (RSI>70) conditions",
  "VWAP Scalp":             "Trade price re-tests of the Volume Weighted Average Price",
  "EMA Crossover":          "EMA-9 crossing above/below EMA-21 triggers entry",
  "Opening Range Breakout": "Breakout above/below first 30-min candle range",
  "RSI + MACD":             "RSI below 35 + bullish MACD histogram cross for confluence",
  "Bollinger Band Squeeze":  "Trade the expansion after a period of low volatility squeeze",
  "Momentum Scalp":         "1%+ price move in 5 min on above-average volume",
  "Bull Call Spread":       "Buy lower-strike call, sell higher-strike call — defined risk",
  "Bear Put Spread":        "Buy higher-strike put, sell lower-strike put — bearish bias",
  "Iron Condor":            "Sell OTM call spread + OTM put spread for premium collection",
  "Covered Call":           "Own underlying shares, sell OTM call to generate income",
};

const INTERVALS: TradeInterval[] = ["1m", "5m", "15m", "1h"];
const RANGES: Record<TradeInterval, string> = {
  "1m": "1d", "5m": "1d", "15m": "5d", "1h": "1mo",
};

const MARKET_COLORS: Record<MarketType, string> = {
  Stock:   "bg-blue-600",
  Options: "bg-purple-600",
  Crypto:  "#f59e0b",
};

// ── Indicator Math ────────────────────────────────────────────────────────────

function calcRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(period).fill(50);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain += Math.max(diff, 0);
    avgLoss += Math.max(-diff, 0);
  }
  avgGain /= period; avgLoss /= period;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcVWAP(candles: CandleBar[]): number[] {
  let cumVolPrice = 0, cumVol = 0;
  return candles.map((c) => {
    const tp = (c.high + c.low + c.close) / 3;
    cumVolPrice += tp * c.volume;
    cumVol += c.volume;
    return cumVol === 0 ? c.close : cumVolPrice / cumVol;
  });
}

function calcBollinger(closes: number[], period = 20): { mid: number[]; upper: number[]; lower: number[] } {
  const mid: number[] = [], upper: number[] = [], lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { mid.push(closes[i]); upper.push(closes[i]); lower.push(closes[i]); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.map(v => (v - avg) ** 2).reduce((a, b) => a + b, 0) / period);
    mid.push(avg); upper.push(avg + 2 * std); lower.push(avg - 2 * std);
  }
  return { mid, upper, lower };
}

function calcMACD(closes: number[]): { macd: number[]; signal: number[]; hist: number[] } {
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macd  = ema12.map((v, i) => v - ema26[i]);
  const signal = calcEMA(macd, 9);
  const hist  = macd.map((v, i) => v - signal[i]);
  return { macd, signal, hist };
}

// ── Black-Scholes ─────────────────────────────────────────────────────────────

function normCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + p * Math.abs(x));
  const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-x * x)));
}

function blackScholes(
  S: number, K: number, T: number, r: number, sigma: number, type: "call" | "put"
): OptionsGreeks {
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const Nd1 = normCDF(d1), Nd2 = normCDF(d2);
  const Nd1neg = normCDF(-d1), Nd2neg = normCDF(-d2);

  const price = type === "call"
    ? S * Nd1 - K * Math.exp(-r * T) * Nd2
    : K * Math.exp(-r * T) * Nd2neg - S * Nd1neg;

  const phi = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  const delta = type === "call" ? Nd1 : Nd1 - 1;
  const gamma = phi / (S * sigma * Math.sqrt(T));
  const theta = type === "call"
    ? (-(S * phi * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * Nd2) / 365
    : (-(S * phi * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * Nd2neg) / 365;
  const vega = S * phi * Math.sqrt(T) / 100;

  return { delta, gamma, theta, vega, impliedVol: sigma * 100, theoreticalPrice: price };
}

// ── Strategy Engine ───────────────────────────────────────────────────────────

function runStrategy(strategy: DayStrategy, candles: CandleBar[]): StrategyResult {
  if (candles.length < 30) {
    return {
      signal: { type: "HOLD", entry: 0, target: 0, stopLoss: 0, riskRewardRatio: 0, reasoning: "Not enough data.", confidence: 0 },
      indicators: {},
    };
  }

  const closes  = candles.map(c => c.close);
  const last    = closes[closes.length - 1];
  const n       = closes.length;

  let signal: TradeSignal;
  let indicators: Record<string, number | string> = {};

  if (strategy === "RSI Reversal" || strategy === "RSI + MACD") {
    const rsi   = calcRSI(closes);
    const rsiNow = rsi[rsi.length - 1];
    indicators = { RSI: +rsiNow.toFixed(1) };

    if (strategy === "RSI + MACD") {
      const { hist } = calcMACD(closes);
      const histNow  = hist[hist.length - 1];
      const histPrev = hist[hist.length - 2];
      indicators["MACD Hist"] = +histNow.toFixed(4);
      const macdCrossUp = histPrev < 0 && histNow > 0;

      if (rsiNow < 35 && macdCrossUp) {
        signal = { type: "BUY", entry: last, target: +(last * 1.025).toFixed(2), stopLoss: +(last * 0.985).toFixed(2), riskRewardRatio: 1.67, reasoning: `RSI=${rsiNow.toFixed(1)} (oversold) + MACD histogram crossed bullish.`, confidence: 82 };
      } else if (rsiNow > 65) {
        signal = { type: "SELL", entry: last, target: +(last * 0.975).toFixed(2), stopLoss: +(last * 1.015).toFixed(2), riskRewardRatio: 1.67, reasoning: `RSI=${rsiNow.toFixed(1)} overbought. Consider shorts or exit longs.`, confidence: 74 };
      } else {
        signal = { type: "HOLD", entry: last, target: +(last * 1.02).toFixed(2), stopLoss: +(last * 0.98).toFixed(2), riskRewardRatio: 1, reasoning: "No RSI+MACD confluence. Wait for setup.", confidence: 40 };
      }
    } else {
      if (rsiNow < 30) {
        signal = { type: "BUY", entry: last, target: +(last * 1.03).toFixed(2), stopLoss: +(last * 0.985).toFixed(2), riskRewardRatio: 2, reasoning: `RSI=${rsiNow.toFixed(1)} — deeply oversold. Mean-reversion long entry.`, confidence: 78 };
      } else if (rsiNow > 70) {
        signal = { type: "SELL", entry: last, target: +(last * 0.97).toFixed(2), stopLoss: +(last * 1.015).toFixed(2), riskRewardRatio: 2, reasoning: `RSI=${rsiNow.toFixed(1)} — overbought. Fade the move or take profit.`, confidence: 76 };
      } else {
        signal = { type: "HOLD", entry: last, target: +(last * 1.03).toFixed(2), stopLoss: +(last * 0.98).toFixed(2), riskRewardRatio: 1.5, reasoning: `RSI=${rsiNow.toFixed(1)} — neutral. No reversal signal yet.`, confidence: 35 };
      }
    }

  } else if (strategy === "EMA Crossover") {
    const ema9  = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const diff  = ema9[n - 1] - ema21[n - 1];
    const diffPrev = ema9[n - 2] - ema21[n - 2];
    indicators = { "EMA 9": +ema9[n - 1].toFixed(2), "EMA 21": +ema21[n - 1].toFixed(2) };

    if (diffPrev < 0 && diff > 0) {
      signal = { type: "BUY", entry: last, target: +(last * 1.025).toFixed(2), stopLoss: +(last * 0.988).toFixed(2), riskRewardRatio: 2.08, reasoning: "EMA-9 crossed above EMA-21 — bullish momentum shift.", confidence: 81 };
    } else if (diffPrev > 0 && diff < 0) {
      signal = { type: "SELL", entry: last, target: +(last * 0.975).toFixed(2), stopLoss: +(last * 1.012).toFixed(2), riskRewardRatio: 2.08, reasoning: "EMA-9 crossed below EMA-21 — bearish momentum shift.", confidence: 79 };
    } else if (diff > 0) {
      signal = { type: "BUY", entry: last, target: +(last * 1.02).toFixed(2), stopLoss: +(last * 0.992).toFixed(2), riskRewardRatio: 2.5, reasoning: "EMA-9 above EMA-21 — trend is bullish. Hold or add on dips.", confidence: 61 };
    } else {
      signal = { type: "SELL", entry: last, target: +(last * 0.98).toFixed(2), stopLoss: +(last * 1.008).toFixed(2), riskRewardRatio: 2.5, reasoning: "EMA-9 below EMA-21 — trend is bearish. Avoid longs.", confidence: 59 };
    }

  } else if (strategy === "VWAP Scalp") {
    const vwap   = calcVWAP(candles);
    const vwapNow = vwap[vwap.length - 1];
    const pctFromVWAP = ((last - vwapNow) / vwapNow) * 100;
    indicators = { VWAP: +vwapNow.toFixed(2), "% from VWAP": +pctFromVWAP.toFixed(2) };

    if (pctFromVWAP < -0.5) {
      signal = { type: "BUY", entry: last, target: +vwapNow.toFixed(2), stopLoss: +(last * 0.993).toFixed(2), riskRewardRatio: 2.1, reasoning: `Price ${Math.abs(pctFromVWAP).toFixed(2)}% below VWAP. Scalp long back to VWAP.`, confidence: 70 };
    } else if (pctFromVWAP > 0.5) {
      signal = { type: "SELL", entry: last, target: +vwapNow.toFixed(2), stopLoss: +(last * 1.007).toFixed(2), riskRewardRatio: 2.1, reasoning: `Price ${pctFromVWAP.toFixed(2)}% above VWAP. Fade the extension back to VWAP.`, confidence: 68 };
    } else {
      signal = { type: "HOLD", entry: last, target: +(last * 1.01).toFixed(2), stopLoss: +(last * 0.995).toFixed(2), riskRewardRatio: 1.3, reasoning: "Price near VWAP. No clear directional scalp opportunity.", confidence: 30 };
    }

  } else if (strategy === "Opening Range Breakout") {
    const first30 = candles.slice(0, Math.min(6, candles.length));
    const orHigh  = Math.max(...first30.map(c => c.high));
    const orLow   = Math.min(...first30.map(c => c.low));
    indicators = { "OR High": +orHigh.toFixed(2), "OR Low": +orLow.toFixed(2) };

    if (last > orHigh * 1.001) {
      signal = { type: "BUY", entry: last, target: +(orHigh + (orHigh - orLow)).toFixed(2), stopLoss: +orHigh.toFixed(2), riskRewardRatio: 1.95, reasoning: `Price broke above Opening Range High ($${orHigh.toFixed(2)}). Target = OR height projected up.`, confidence: 75 };
    } else if (last < orLow * 0.999) {
      signal = { type: "SELL", entry: last, target: +(orLow - (orHigh - orLow)).toFixed(2), stopLoss: +orLow.toFixed(2), riskRewardRatio: 1.95, reasoning: `Price broke below Opening Range Low ($${orLow.toFixed(2)}). Target = OR height projected down.`, confidence: 73 };
    } else {
      signal = { type: "HOLD", entry: last, target: +orHigh.toFixed(2), stopLoss: +orLow.toFixed(2), riskRewardRatio: 1, reasoning: "Price inside Opening Range. Wait for a confirmed break.", confidence: 25 };
    }

  } else if (strategy === "Bollinger Band Squeeze") {
    const bb     = calcBollinger(closes);
    const width  = (bb.upper[n - 1] - bb.lower[n - 1]) / bb.mid[n - 1] * 100;
    const widthPrev5 = Array.from({ length: 5 }, (_, i) =>
      (bb.upper[n - 2 - i] - bb.lower[n - 2 - i]) / bb.mid[n - 2 - i] * 100
    );
    const avgWidth5 = widthPrev5.reduce((a, b) => a + b, 0) / 5;
    indicators = { "Band Width": +width.toFixed(2), "Avg Width (5)": +avgWidth5.toFixed(2), "BB Upper": +bb.upper[n - 1].toFixed(2), "BB Lower": +bb.lower[n - 1].toFixed(2) };

    if (width > avgWidth5 * 1.2 && last > bb.upper[n - 2]) {
      signal = { type: "BUY", entry: last, target: +(last * 1.03).toFixed(2), stopLoss: +bb.mid[n - 1].toFixed(2), riskRewardRatio: 2.0, reasoning: "Bands expanding after squeeze. Price broke above upper band — ride the breakout.", confidence: 77 };
    } else if (width > avgWidth5 * 1.2 && last < bb.lower[n - 2]) {
      signal = { type: "SELL", entry: last, target: +(last * 0.97).toFixed(2), stopLoss: +bb.mid[n - 1].toFixed(2), riskRewardRatio: 2.0, reasoning: "Bands expanding after squeeze. Price broke below lower band — short the breakdown.", confidence: 75 };
    } else {
      signal = { type: "HOLD", entry: last, target: +bb.upper[n - 1].toFixed(2), stopLoss: +bb.lower[n - 1].toFixed(2), riskRewardRatio: 1, reasoning: `Bands in ${width < avgWidth5 ? "squeeze" : "expansion"}. Wait for breakout direction confirmation.`, confidence: 32 };
    }

  } else if (strategy === "Momentum Scalp") {
    const recent   = candles.slice(-12);
    const movePct  = ((recent[recent.length - 1].close - recent[0].open) / recent[0].open) * 100;
    const avgVol5  = candles.slice(-6).reduce((a, c) => a + c.volume, 0) / 6;
    const avgVolAll = candles.reduce((a, c) => a + c.volume, 0) / candles.length;
    const volRatio  = avgVol5 / (avgVolAll || 1);
    indicators = { "Move (1hr)": `${movePct >= 0 ? "+" : ""}${movePct.toFixed(2)}%`, "Vol Ratio": +volRatio.toFixed(2) };

    if (movePct > 0.8 && volRatio > 1.3) {
      signal = { type: "BUY", entry: last, target: +(last * 1.015).toFixed(2), stopLoss: +(last * 0.993).toFixed(2), riskRewardRatio: 2.14, reasoning: `+${movePct.toFixed(2)}% move on ${volRatio.toFixed(1)}x volume. Strong bullish momentum.`, confidence: 80 };
    } else if (movePct < -0.8 && volRatio > 1.3) {
      signal = { type: "SELL", entry: last, target: +(last * 0.985).toFixed(2), stopLoss: +(last * 1.007).toFixed(2), riskRewardRatio: 2.14, reasoning: `${movePct.toFixed(2)}% drop on ${volRatio.toFixed(1)}x volume. Strong bearish momentum.`, confidence: 78 };
    } else {
      signal = { type: "HOLD", entry: last, target: +(last * 1.015).toFixed(2), stopLoss: +(last * 0.99).toFixed(2), riskRewardRatio: 1.5, reasoning: "No strong momentum signal. Move or volume not yet significant.", confidence: 30 };
    }

  } else {
    // Options strategies — base on underlying price direction via EMA
    const ema9  = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const trend  = ema9[n - 1] > ema21[n - 1] ? "bullish" : "bearish";
    indicators = { "Underlying": `$${last.toFixed(2)}`, "Trend": trend, "EMA9": +ema9[n - 1].toFixed(2), "EMA21": +ema21[n - 1].toFixed(2) };

    if (strategy === "Covered Call") {
      signal = { type: "HOLD", entry: last, target: +(last * 1.05).toFixed(2), stopLoss: +(last * 0.92).toFixed(2), riskRewardRatio: 1.5, reasoning: "Sell OTM call ~5% above current price for premium income. Max gain = strike − cost basis + premium.", confidence: 72 };
    } else if (strategy === "Bull Call Spread") {
      signal = { type: trend === "bullish" ? "BUY" : "HOLD", entry: last, target: +(last * 1.06).toFixed(2), stopLoss: +(last * 0.97).toFixed(2), riskRewardRatio: 2, reasoning: `Buy ATM call, sell ${(last * 1.05).toFixed(0)} call. Max profit if price > short strike at expiry.`, confidence: trend === "bullish" ? 71 : 45 };
    } else if (strategy === "Bear Put Spread") {
      signal = { type: trend === "bearish" ? "SELL" : "HOLD", entry: last, target: +(last * 0.94).toFixed(2), stopLoss: +(last * 1.03).toFixed(2), riskRewardRatio: 2, reasoning: `Buy ATM put, sell ${(last * 0.95).toFixed(0)} put. Max profit if price < short strike at expiry.`, confidence: trend === "bearish" ? 71 : 45 };
    } else {
      // Iron Condor
      signal = { type: "HOLD", entry: last, target: last, stopLoss: +(last * 0.9).toFixed(2), riskRewardRatio: 0.7, reasoning: `Sell ${(last * 1.05).toFixed(0)} call / ${(last * 1.08).toFixed(0)} call + ${(last * 0.95).toFixed(0)} put / ${(last * 0.92).toFixed(0)} put. Profitable if price stays within wings.`, confidence: 65 };
    }
  }

  return { signal: signal!, indicators };
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props {
  currency?: string;
}

export default function DayTradingLab({ currency = "USD" }: Props) {
  const [marketType, setMarketType]   = useState<MarketType>("Stock");
  const [strategy, setStrategy]       = useState<DayStrategy>("RSI Reversal");
  const [interval, setInterval]       = useState<TradeInterval>("5m");
  const [symbol, setSymbol]           = useState("");
  const [symbolInput, setSymbolInput] = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const [candles,  setCandles]        = useState<CandleBar[]>([]);
  const [quote,    setQuote]          = useState<any>(null);
  const [result,   setResult]         = useState<StrategyResult | null>(null);

  // Movers
  const [movers, setMovers]           = useState<any[]>([]);
  const [moversLoading, setMoversLoading] = useState(false);
  const [selectedMoverIdx, setSelectedMoverIdx] = useState<number | null>(null);

  // P&L sim
  const [posSize, setPosSize] = useState(100);

  // Options
  const [optType,  setOptType]  = useState<"call" | "put">("call");
  const [optStrike, setOptStrike] = useState(0);
  const [optDTE,   setOptDTE]   = useState(30);
  const [greeks,   setGreeks]   = useState<OptionsGreeks | null>(null);

  const chartRef = useRef<HTMLDivElement>(null);
  const chartObj = useRef<any>(null);

  // Fetch movers on mount and when market type changes
  const fetchMovers = useCallback(async (type: MarketType) => {
    const apiType = type === "Options" ? "Stock" : type;
    setMoversLoading(true);
    try {
      const res = await fetch(`/api/market/movers?type=${apiType}`);
      if (res.ok) {
        const data = await res.json();
        setMovers(data.movers || []);
      }
    } catch (e) {
      console.warn("Failed to fetch movers:", e);
    } finally {
      setMoversLoading(false);
    }
  }, []);

  // When market type changes, auto-select first strategy and refresh movers
  useEffect(() => {
    setStrategy(STRATEGIES_BY_MARKET[marketType][0]);
    setResult(null);
    setCandles([]);
    setQuote(null);
    setSelectedMoverIdx(null);
    fetchMovers(marketType);
  }, [marketType, fetchMovers]);

  // Rebuild chart when candles change
  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;
    if (chartObj.current) { chartObj.current.remove(); chartObj.current = null; }

    const chart = createChart(chartRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#64748b",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(226,232,240,0.2)" },
        horzLines: { color: "rgba(226,232,240,0.2)" },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: "rgba(226,232,240,0.3)" },
      timeScale: { borderColor: "rgba(226,232,240,0.3)", timeVisible: true, secondsVisible: false },
      width:  chartRef.current.clientWidth,
      height: 300,
    });

    // Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor:       "#10b981",
      downColor:     "#ef4444",
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor:   "#10b981",
      wickDownColor: "#ef4444",
    });
    candleSeries.setData(candles.map(c => ({ time: c.time as any, open: c.open, high: c.high, low: c.low, close: c.close })));

    // Volume histogram
    const volSeries = chart.addSeries(HistogramSeries, {
      color: "rgba(99,102,241,0.25)",
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volSeries.setData(candles.map(c => ({ time: c.time as any, value: c.volume, color: c.close >= c.open ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)" })));

    // Overlay indicators based on strategy
    const closes = candles.map(c => c.close);

    if (strategy === "EMA Crossover" || strategy.includes("MACD") || strategy.includes("Call") || strategy.includes("Put") || strategy.includes("Condor") || strategy === "Covered Call") {
      const ema9  = calcEMA(closes, 9);
      const ema21 = calcEMA(closes, 21);
      const ema9Series = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      const ema21Series = chart.addSeries(LineSeries, { color: "#8b5cf6", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
      ema9Series.setData(candles.map((c, i) => ({ time: c.time as any, value: ema9[i] })));
      ema21Series.setData(candles.map((c, i) => ({ time: c.time as any, value: ema21[i] })));
    }

    if (strategy === "VWAP Scalp") {
      const vwap = calcVWAP(candles);
      const vwapSeries = chart.addSeries(LineSeries, { color: "#06b6d4", lineWidth: 2, lineStyle: 1, priceLineVisible: false, lastValueVisible: false });
      vwapSeries.setData(candles.map((c, i) => ({ time: c.time as any, value: vwap[i] })));
    }

    if (strategy === "Bollinger Band Squeeze") {
      const bb = calcBollinger(closes);
      const midS  = chart.addSeries(LineSeries, { color: "#94a3b8", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      const upS   = chart.addSeries(LineSeries, { color: "#8b5cf6", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      const lowS  = chart.addSeries(LineSeries, { color: "#8b5cf6", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false });
      midS.setData(candles.map((c, i)  => ({ time: c.time as any, value: bb.mid[i]   })));
      upS.setData( candles.map((c, i)  => ({ time: c.time as any, value: bb.upper[i] })));
      lowS.setData(candles.map((c, i)  => ({ time: c.time as any, value: bb.lower[i] })));
    }

    chart.timeScale().fitContent();
    chartObj.current = chart;

    const resizeObserver = new ResizeObserver(() => {
      if (chartRef.current) chart.applyOptions({ width: chartRef.current.clientWidth });
    });
    resizeObserver.observe(chartRef.current);
    return () => { resizeObserver.disconnect(); };
  }, [candles, strategy]);

  // Compute options Greeks whenever relevant inputs change
  useEffect(() => {
    if (marketType !== "Options" || !quote?.price) return;
    const S = quote.price;
    const K = optStrike || S;
    const T = optDTE / 365;
    const r = 0.053;
    const sigma = 0.28;
    setGreeks(blackScholes(S, K, T, r, sigma, optType));
  }, [marketType, quote, optStrike, optDTE, optType]);

  // Update strike default when quote loads
  useEffect(() => {
    if (quote?.price) setOptStrike(+quote.price.toFixed(0));
  }, [quote]);

  const fetchData = useCallback(async (overrideSymbol?: string) => {
    const sym = (overrideSymbol || symbolInput).trim().toUpperCase();
    if (!sym) return;
    if (overrideSymbol) setSymbolInput(sym);
    setLoading(true);
    setError(null);
    setResult(null);
    setCandles([]);
    setQuote(null);

    try {
      const range = RANGES[interval];
      const [candleRes, priceRes] = await Promise.all([
        fetch(`/api/market/candles?symbol=${sym}&interval=${interval}&range=${range}`),
        fetch(`/api/market/price?symbol=${sym}`),
      ]);
      if (!candleRes.ok) throw new Error(`Candle fetch failed: ${candleRes.statusText}`);
      const candleData = await candleRes.json();
      const priceData  = priceRes.ok ? await priceRes.json() : null;

      const bars: CandleBar[] = candleData.candles || [];
      if (bars.length === 0) throw new Error("No candle data returned. Market may be closed or symbol invalid.");

      setCandles(bars);
      setSymbol(sym);
      if (priceData) setQuote(priceData);

      const res = runStrategy(strategy, bars);
      setResult(res);
    } catch (e: any) {
      setError(e.message || "Failed to pull data.");
    } finally {
      setLoading(false);
    }
  }, [symbolInput, interval, strategy]);

  // ── P&L Calculations ──────────────────────────────────────────────────────
  const pnlTarget = result ? ((result.signal.target - result.signal.entry) * posSize) : 0;
  const pnlStop   = result ? ((result.signal.stopLoss - result.signal.entry) * posSize) : 0;

  const SignalBadge = ({ type }: { type: "BUY" | "SELL" | "HOLD" }) => {
    const cfg = {
      BUY:  { bg: "bg-emerald-500", text: "text-white", icon: <TrendingUp  className="w-5 h-5" />, label: "BUY" },
      SELL: { bg: "bg-red-500",     text: "text-white", icon: <TrendingDown className="w-5 h-5" />, label: "SELL" },
      HOLD: { bg: "bg-slate-400",   text: "text-white", icon: <Minus        className="w-5 h-5" />, label: "HOLD" },
    }[type];
    return (
      <div className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-extrabold text-lg tracking-wide shadow-sm ${cfg.bg} ${cfg.text}`}>
        {cfg.icon} {cfg.label}
      </div>
    );
  };

  const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Controls Bar ───────────────────────────────────────────────────── */}
      <div className="bg-white border border-outline-variant rounded-2xl p-4 shadow-xs">
        <div className="flex flex-wrap gap-3 items-end">

          {/* Market Type */}
          <div className="flex flex-col gap-1 min-w-[130px]">
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Market</label>
            <div className="flex gap-1">
              {(["Stock", "Options", "Crypto"] as MarketType[]).map(m => (
                <button
                  key={m}
                  onClick={() => setMarketType(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    marketType === m
                      ? m === "Stock" ? "bg-blue-600 border-blue-600 text-white"
                        : m === "Options" ? "bg-purple-600 border-purple-600 text-white"
                        : "bg-amber-500 border-amber-500 text-white"
                      : "border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Symbol */}
          <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Symbol</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant" />
              <input
                value={symbolInput}
                onChange={e => setSymbolInput(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === "Enter" && fetchData()}
                placeholder={marketType === "Crypto" ? "BTC-USD" : "AAPL"}
                className="w-full pl-8 pr-3 py-2 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm font-mono font-bold uppercase"
              />
            </div>
          </div>

          {/* Strategy */}
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Strategy</label>
            <div className="relative">
              <select
                value={strategy}
                onChange={e => { setStrategy(e.target.value as DayStrategy); setResult(null); }}
                className="w-full px-3 py-2 pr-8 border border-outline-variant rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-sm font-semibold appearance-none bg-white"
              >
                {STRATEGIES_BY_MARKET[marketType].map(s => <option key={s}>{s}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant pointer-events-none" />
            </div>
          </div>

          {/* Interval */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Interval</label>
            <div className="flex gap-1">
              {INTERVALS.map(iv => (
                <button
                  key={iv}
                  onClick={() => setInterval(iv)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                    interval === iv
                      ? "bg-primary border-primary text-white"
                      : "border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary"
                  }`}
                >{iv}</button>
              ))}
            </div>
          </div>

          {/* Pull Data Button */}
          <button
            id="pull-data-btn"
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 bg-secondary text-white px-5 py-2 rounded-xl font-bold text-sm shadow-sm hover:bg-opacity-90 active:scale-95 transition-all disabled:opacity-60 whitespace-nowrap"
          >
            {loading
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Pulling...</>
              : <><RefreshCw className="w-4 h-4" /> Pull Live Data</>
            }
          </button>
        </div>

        {/* Strategy description */}
        <p className="mt-3 text-[11px] text-on-surface-variant flex items-start gap-1.5">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-outline" />
          {STRATEGY_DESC[strategy]}
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm font-medium">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Live Quote Bar ─────────────────────────────────────────────────── */}
      {quote && (
        <div className="bg-white border border-outline-variant rounded-2xl p-4 shadow-xs flex flex-wrap gap-6 items-center">
          <div>
            <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider font-mono">{quote.exchange}</p>
            <p className="text-xl font-extrabold text-primary font-mono">{quote.symbol}</p>
            <p className="text-xs text-on-surface-variant font-medium truncate max-w-[180px]">{quote.name}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Last Price</p>
            <p className="text-2xl font-extrabold font-mono text-primary">{fmt(quote.price)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Change</p>
            <p className={`text-lg font-bold font-mono ${quote.changePct >= 0 ? "text-emerald-600" : "text-red-500"}`}>
              {quote.changePct >= 0 ? "+" : ""}{quote.changePct.toFixed(2)}%
            </p>
          </div>
          {[
            { label: "Open",    val: fmt(quote.open) },
            { label: "High",    val: fmt(quote.high) },
            { label: "Low",     val: fmt(quote.low) },
            { label: "Vol",     val: (quote.volume / 1e6).toFixed(1) + "M" },
          ].map(({ label, val }) => (
            <div key={label} className="text-center">
              <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">{label}</p>
              <p className="text-sm font-bold font-mono text-primary">{val}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Chart + Signal Row ─────────────────────────────────────────────── */}
      {candles.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Candlestick Chart */}
          <div className="lg:col-span-2 bg-white border border-outline-variant rounded-2xl p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-primary flex items-center gap-2 text-sm">
                <BarChart2 className="w-4 h-4 text-secondary" />
                {symbol} — {interval} Chart
              </h3>
              <span className="text-[10px] font-mono text-on-surface-variant flex items-center gap-1">
                <Clock className="w-3 h-3" /> {candles.length} candles
              </span>
            </div>

            {/* Legend */}
            <div className="flex gap-4 mb-2 flex-wrap">
              {(strategy === "EMA Crossover" || strategy === "RSI + MACD" || strategy.includes("Spread") || strategy === "Iron Condor" || strategy === "Covered Call") && (
                <><span className="text-[10px] font-bold flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-400 inline-block" /> EMA 9</span>
                <span className="text-[10px] font-bold flex items-center gap-1"><span className="w-3 h-0.5 bg-violet-500 inline-block" /> EMA 21</span></>
              )}
              {strategy === "VWAP Scalp" && <span className="text-[10px] font-bold flex items-center gap-1"><span className="w-3 h-0.5 bg-cyan-500 inline-block" /> VWAP</span>}
              {strategy === "Bollinger Band Squeeze" && <span className="text-[10px] font-bold flex items-center gap-1"><span className="w-3 h-0.5 bg-violet-400 inline-block border-dashed" /> Bollinger Bands</span>}
            </div>

            <div ref={chartRef} className="w-full" />
          </div>

          {/* Signal Panel */}
          {result && (
            <div className="bg-white border border-outline-variant rounded-2xl p-5 shadow-xs flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-primary text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-secondary" /> Signal
                </h3>
                <SignalBadge type={result.signal.type} />
              </div>

              {/* Confidence bar */}
              <div>
                <div className="flex justify-between text-[10px] font-bold text-on-surface-variant mb-1">
                  <span>CONFIDENCE</span><span>{result.signal.confidence}%</span>
                </div>
                <div className="w-full h-2 bg-surface-container rounded-full overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all ${result.signal.confidence >= 70 ? "bg-emerald-500" : result.signal.confidence >= 50 ? "bg-amber-400" : "bg-slate-400"}`}
                    style={{ width: `${result.signal.confidence}%` }}
                  />
                </div>
              </div>

              <p className="text-xs text-on-surface-variant leading-relaxed border-l-2 border-secondary pl-3">
                {result.signal.reasoning}
              </p>

              {/* Key levels */}
              <div className="grid grid-cols-1 gap-2">
                <div className="flex justify-between items-center bg-surface-container-lowest border border-outline-variant rounded-lg p-2.5">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide flex items-center gap-1"><DollarSign className="w-3 h-3" /> Entry</span>
                  <span className="font-mono font-bold text-sm text-primary">{fmt(result.signal.entry)}</span>
                </div>
                <div className="flex justify-between items-center bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide flex items-center gap-1"><Target className="w-3 h-3" /> Target</span>
                  <span className="font-mono font-bold text-sm text-emerald-700">{fmt(result.signal.target)}</span>
                </div>
                <div className="flex justify-between items-center bg-red-50 border border-red-200 rounded-lg p-2.5">
                  <span className="text-[10px] font-bold text-red-600 uppercase tracking-wide flex items-center gap-1"><ShieldAlert className="w-3 h-3" /> Stop Loss</span>
                  <span className="font-mono font-bold text-sm text-red-600">{fmt(result.signal.stopLoss)}</span>
                </div>
                <div className="flex justify-between items-center bg-surface-container-lowest border border-outline-variant rounded-lg p-2.5">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Risk/Reward</span>
                  <span className="font-mono font-bold text-sm text-primary">1 : {result.signal.riskRewardRatio.toFixed(2)}</span>
                </div>
              </div>

              {/* Indicator values */}
              {Object.keys(result.indicators).length > 0 && (
                <div className="border-t border-outline-variant pt-3">
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-2">Indicators</p>
                  <div className="space-y-1">
                    {Object.entries(result.indicators).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-xs">
                        <span className="font-mono text-on-surface-variant">{k}</span>
                        <span className="font-mono font-bold text-primary">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── P&L Simulator ─────────────────────────────────────────────────── */}
      {result && result.signal.entry > 0 && (
        <div className="bg-white border border-outline-variant rounded-2xl p-5 shadow-xs">
          <h3 className="font-bold text-primary mb-4 flex items-center gap-2 text-sm">
            <Activity className="w-4 h-4 text-secondary" /> P&L Simulator
          </h3>
          <div className="flex flex-wrap gap-6 items-start">
            {/* Size input */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                {marketType === "Options" ? "Contracts (×100)" : "Shares / Units"}
              </label>
              <input
                type="number"
                value={posSize}
                min={1}
                onChange={e => setPosSize(Math.max(1, Number(e.target.value)))}
                className="w-28 px-3 py-2 border border-outline-variant rounded-lg font-mono font-bold text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Cost basis */}
            <div className="text-center">
              <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Position Cost</p>
              <p className="text-lg font-extrabold font-mono text-primary">
                {fmt(result.signal.entry * posSize * (marketType === "Options" ? 100 : 1))}
              </p>
            </div>

            {/* Target P&L */}
            <div className="text-center">
              <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Profit at Target</p>
              <p className={`text-xl font-extrabold font-mono ${pnlTarget >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {pnlTarget >= 0 ? "+" : ""}{fmt(pnlTarget * (marketType === "Options" ? 100 : 1))}
              </p>
              <p className="text-[10px] text-on-surface-variant font-mono">
                {pnlTarget !== 0 ? `${((pnlTarget / (result.signal.entry * posSize)) * 100).toFixed(1)}% return` : ""}
              </p>
            </div>

            {/* Stop P&L */}
            <div className="text-center">
              <p className="text-[10px] font-bold text-red-600 uppercase tracking-wider">Loss at Stop</p>
              <p className="text-xl font-extrabold font-mono text-red-500">
                {fmt(pnlStop * (marketType === "Options" ? 100 : 1))}
              </p>
              <p className="text-[10px] text-on-surface-variant font-mono">
                {pnlStop !== 0 ? `${((pnlStop / (result.signal.entry * posSize)) * 100).toFixed(1)}% loss` : ""}
              </p>
            </div>

            {/* Break-even / R multiple */}
            <div className="text-center">
              <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">R-Multiple</p>
              <p className="text-xl font-extrabold font-mono text-primary">
                1 R = {fmt(Math.abs(pnlStop) * (marketType === "Options" ? 100 : 1))}
              </p>
              <p className="text-[10px] text-on-surface-variant font-mono">risk per trade</p>
            </div>
          </div>

          {/* Equity bar */}
          {(pnlTarget !== 0 || pnlStop !== 0) && (
            <div className="mt-4 h-3 rounded-full overflow-hidden flex">
              <div className="bg-red-400 h-full transition-all" style={{ width: "40%" }} title="Risk" />
              <div className="bg-slate-200 h-full transition-all" style={{ width: "5%" }} />
              <div className="bg-emerald-400 h-full transition-all" style={{ width: "55%" }} title="Reward" />
            </div>
          )}
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-red-500 font-bold">Risk</span>
            <span className="text-[10px] text-emerald-600 font-bold">Reward</span>
          </div>
        </div>
      )}

      {/* ── Options Greeks Panel ───────────────────────────────────────────── */}
      {marketType === "Options" && quote && (
        <div className="bg-white border border-outline-variant rounded-2xl p-5 shadow-xs">
          <h3 className="font-bold text-primary mb-4 flex items-center gap-2 text-sm">
            <TrendingUp className="w-4 h-4 text-purple-600" /> Options Greeks
            <span className="text-[10px] font-normal text-on-surface-variant">(Black-Scholes, IV=28%)</span>
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {[
              { label: "Option Type", val: <div className="flex gap-2">
                {(["call","put"] as const).map(t => (
                  <button key={t} onClick={() => setOptType(t)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold border transition-all ${optType === t ? "bg-purple-600 text-white border-purple-600" : "border-outline-variant text-on-surface-variant"}`}>
                    {t.toUpperCase()}
                  </button>
                ))}
              </div>},
              { label: "Strike Price $", val: <input type="number" value={optStrike} onChange={e => setOptStrike(Number(e.target.value))} className="w-full px-2 py-1 border border-outline-variant rounded-lg font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-500" /> },
              { label: "Days to Expiry", val: <input type="number" value={optDTE} min={1} max={365} onChange={e => setOptDTE(Number(e.target.value))} className="w-full px-2 py-1 border border-outline-variant rounded-lg font-mono text-sm font-bold focus:outline-none focus:ring-2 focus:ring-purple-500" /> },
              { label: "Underlying", val: <span className="font-mono font-bold text-primary">{fmt(quote.price)}</span> },
            ].map(({ label, val }) => (
              <div key={label} className="bg-surface-container-lowest border border-outline-variant rounded-xl p-3">
                <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider mb-1">{label}</p>
                <div className="text-sm">{val}</div>
              </div>
            ))}
          </div>

          {greeks && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: "Theo. Price", val: fmt(greeks.theoreticalPrice), color: "text-purple-700" },
                { label: "Delta Δ",     val: greeks.delta.toFixed(4),      color: greeks.delta > 0 ? "text-emerald-600" : "text-red-500" },
                { label: "Gamma Γ",     val: greeks.gamma.toFixed(6),      color: "text-primary" },
                { label: "Theta Θ/day",     val: fmt(greeks.theta),            color: "text-red-500" },
                { label: "Vega ν /1%",      val: fmt(greeks.vega),             color: "text-blue-600" },
                { label: "Impl. Vol",   val: `${greeks.impliedVol.toFixed(1)}%`, color: "text-amber-600" },
              ].map(({ label, val, color }) => (
                <div key={label} className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-center">
                  <p className="text-[10px] font-bold text-purple-700 uppercase tracking-wider">{label}</p>
                  <p className={`font-mono font-extrabold text-base mt-1 ${color}`}>{val}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Top Movers List ────────────────────────────────────────────── */}
      {candles.length === 0 && !error && (
        <div className="bg-white border border-outline-variant rounded-2xl shadow-xs overflow-hidden">
          <div className="px-5 py-4 border-b border-outline-variant flex items-center justify-between">
            <h3 className="font-bold text-primary flex items-center gap-2 text-sm">
              <Flame className="w-4 h-4 text-amber-500" />
              Today's Top Movers — Highest Profit Potential
            </h3>
            <button
              onClick={() => fetchMovers(marketType)}
              disabled={moversLoading}
              className="flex items-center gap-1.5 text-[11px] font-bold text-on-surface-variant hover:text-primary transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${moversLoading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          {moversLoading && movers.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-on-surface-variant">
              <Loader2 className="w-6 h-6 animate-spin mr-2" />
              <span className="font-medium text-sm">Loading market data...</span>
            </div>
          ) : movers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-on-surface-variant">
              <BarChart2 className="w-10 h-10 mb-3 text-outline" strokeWidth={1} />
              <p className="text-sm">No movers data available. Try refreshing.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-container-low text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                    <th className="px-4 py-2.5 text-left w-12">#</th>
                    <th className="px-4 py-2.5 text-left">Symbol</th>
                    <th className="px-4 py-2.5 text-left hidden sm:table-cell">Name</th>
                    <th className="px-4 py-2.5 text-right">Price</th>
                    <th className="px-4 py-2.5 text-right">Change</th>
                    <th className="px-4 py-2.5 text-right hidden md:table-cell">Volume</th>
                    <th className="px-4 py-2.5 text-center w-24">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {movers.map((m: any, idx: number) => {
                    const isSelected = selectedMoverIdx === idx;
                    const isPositive = m.changePct >= 0;
                    return (
                      <tr
                        key={m.symbol}
                        className={`border-t border-outline-variant/40 cursor-pointer transition-all hover:bg-blue-50/60 ${
                          isSelected ? "bg-blue-50 ring-1 ring-inset ring-blue-300" : ""
                        }`}
                        onClick={() => {
                          setSymbolInput(m.symbol);
                          setSelectedMoverIdx(idx);
                        }}
                      >
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-extrabold ${
                            idx === 0 ? "bg-amber-100 text-amber-700" :
                            idx === 1 ? "bg-slate-100 text-slate-600" :
                            idx === 2 ? "bg-orange-100 text-orange-700" :
                            "bg-surface-container text-on-surface-variant"
                          }`}>
                            {idx < 3 ? <Crown className="w-3 h-3" /> : idx + 1}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-extrabold text-primary text-sm">{m.symbol}</span>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-on-surface-variant text-xs truncate max-w-[150px] block">{m.name}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-mono font-bold text-primary">{fmt(m.price)}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className={`font-mono font-bold px-2 py-0.5 rounded-md text-xs ${
                            isPositive
                              ? "text-emerald-700 bg-emerald-50"
                              : "text-red-600 bg-red-50"
                          }`}>
                            {isPositive ? "+" : ""}{m.changePct.toFixed(2)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right hidden md:table-cell">
                          <span className="font-mono text-xs text-on-surface-variant">
                            {m.volume >= 1e9 ? (m.volume / 1e9).toFixed(1) + "B" :
                             m.volume >= 1e6 ? (m.volume / 1e6).toFixed(1) + "M" :
                             m.volume >= 1e3 ? (m.volume / 1e3).toFixed(0) + "K" :
                             m.volume.toLocaleString()}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMoverIdx(idx);
                              fetchData(m.symbol);
                            }}
                            className="bg-secondary text-white px-3 py-1 rounded-lg text-[10px] font-bold hover:bg-opacity-90 active:scale-95 transition-all shadow-xs"
                          >
                            Trade
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
