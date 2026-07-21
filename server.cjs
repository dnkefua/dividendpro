var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var import_express = __toESM(require("express"), 1);
var import_path = __toESM(require("path"), 1);
var import_dotenv = __toESM(require("dotenv"), 1);
var import_genai = require("@google/genai");
var import_vite = require("vite");
var import_ws = require("ws");
import_dotenv.default.config();
var PORT = 3e3;
var aiClient = null;
function getAiClient() {
  const key = process.env.GEMINI_API_KEY;
  const isVertex = process.env.GCP_PROJECT_ID || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!aiClient) {
    if (key) {
      aiClient = new import_genai.GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build"
          }
        }
      });
    } else if (isVertex) {
      aiClient = new import_genai.GoogleGenAI({});
    } else {
      console.warn("GEMINI_API_KEY is missing. Initializing with local dev key to prevent crash on boot.");
      aiClient = new import_genai.GoogleGenAI({
        apiKey: "AIzaSyD-mockKeyForLocalBootstrapping"
      });
    }
  }
  return aiClient;
}
async function startServer() {
  const app = (0, import_express.default)();
  app.use(import_express.default.json());
  app.post("/api/gemini/analyze", async (req, res) => {
    try {
      const { symbol, name, sector, price, yieldVal, payoutRatio, safetyScore, whyPick, customPrompt, assetType } = req.body;
      const ai = getAiClient();
      const isCrypto = assetType === "Crypto";
      let contentPrompt = "";
      if (customPrompt) {
        if (isCrypto) {
          contentPrompt = `Regarding ${name} (${symbol}) in the ${sector} category (Price: $${price}, Yield: ${yieldVal}%, Safety: ${safetyScore}/100): ${customPrompt}`;
        } else {
          contentPrompt = `Regarding ${name} (${symbol}) in the ${sector} sector (Price: $${price}, Yield: ${yieldVal}%, Payout Ratio: ${payoutRatio}%, Safety: ${safetyScore}/100): ${customPrompt}`;
        }
      } else {
        if (isCrypto) {
          contentPrompt = `Provide a comprehensive professional yield and risk analysis for the cryptocurrency asset ${name} (${symbol}) in the ${sector} category. 
- Asset Price: $${price}
- Staking/Lending Yield: ${yieldVal}%
- Protocol Safety Score: ${safetyScore}/100 (Label: ${safetyScore >= 80 ? "Very Safe" : safetyScore >= 60 ? "Safe" : safetyScore >= 45 ? "Borderline" : "Risky"})
- Yield Rationale: "${whyPick}"

Please analyze:
1. **Yield Sustainability & Tokenomics**: Can the protocol maintain this staking or lending yield? How does token inflation or emission affect long-term valuation?
2. **Security & Smart Contract Risks**: Are there smart contract audit logs, slashing risks (for PoS consensus), or protocol vulnerability history?
3. **Market Peg & Liquidity Risks**: For stablecoins, analyze peg backing, reserve assets, or pool liquidity depth.
4. **Yield Comparison**: Compare this yield with industry benchmarks (e.g., standard Ethereum staking or high-yield DeFi money markets).

Format your response in beautifully-structured Markdown, utilizing bold key terms, clear lists, and scannable headers. Keep it high-density, precise, and institutional-grade.`;
        } else {
          contentPrompt = `Provide a comprehensive professional dividend analysis for ${name} (${symbol}), sector: ${sector}. 
- Stock Price: $${price}
- Dividend Yield: ${yieldVal}%
- Payout Ratio: ${payoutRatio}%
- Dividend Safety Score: ${safetyScore}/100 (Label: ${safetyScore >= 80 ? "Very Safe" : safetyScore >= 60 ? "Safe" : safetyScore >= 45 ? "Borderline" : "Risky"})
- Pick Rationale: "${whyPick}"

Please analyze:
1. **Dividend Sustainability**: Can they maintain and grow this yield given the ${payoutRatio}% payout ratio?
2. **Growth Outlook & Historical Strength**: What does the future look like?
3. **Risks or Value Traps**: Are there warning flags (interest rates, debt, etc.)?
4. **Sector Competitiveness**: Compare with sector averages.

Format your response in beautifully-structured Markdown, utilizing bold key terms, clear lists, and scannable headers. Keep it high-density, precise, and institutional-grade.`;
        }
      }
      const systemInstruction = isCrypto ? "You are an elite, highly conservative decentralized finance (DeFi) risk officer and blockchain protocol auditor. You write with clinical, highly structured, objective, and authoritative blockchain and financial precision." : "You are an elite, highly conservative financial analyst and dividend safety expert. You write with clinical, highly structured, objective, and authoritative financial precision.";
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: contentPrompt,
        config: {
          systemInstruction
        }
      });
      res.json({ analysis: response.text });
    } catch (error) {
      console.error("Gemini analysis failed:", error);
      res.status(500).json({ error: error.message || "Failed to generate AI analysis." });
    }
  });
  app.post("/api/gemini/chat", async (req, res) => {
    try {
      const { message } = req.body;
      const ai = getAiClient();
      const chat = ai.chats.create({
        model: "gemini-2.5-flash",
        config: {
          systemInstruction: "You are the Lumina Finance DividendPro AI Assistant. You help users analyze high-yield stock lists, calculate hypothetical compound growth of their portfolio ($482,910.42 yielding ~5%), identify potential dividend traps, and provide intelligent forecasting based on standard financial models. Keep answers clean, structured, and professional."
        }
      });
      const response = await chat.sendMessage({ message });
      res.json({ text: response.text });
    } catch (error) {
      console.error("Gemini chat failed:", error);
      res.status(500).json({ error: error.message || "Failed to communicate with AI Assistant." });
    }
  });
  app.post("/api/vibe/debate", async (req, res) => {
    try {
      const { prompt, symbol } = req.body;
      if (!prompt) return res.status(400).json({ error: "Strategy prompt is required" });
      const hasRealKey = process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEY.startsWith("AIzaSyD-mock");
      let result;
      if (hasRealKey) {
        try {
          const ai = getAiClient();
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `You are an AI investment committee. Evaluate the following trading strategy for the asset "${symbol || "General Market"}":
Strategy prompt: "${prompt}"

Provide your response in raw JSON format with the following exact keys:
{
  "macro": "Detailed macro analyst perspective on pros/cons of this setup",
  "bear": "Detailed short-seller/bear perspective highlighting pitfalls, resistance, or market headwinds",
  "risk": "Detailed risk manager perspective suggesting position sizes, stop loss distance, and risk parameters",
  "consensus": "Summary consensus recommendation",
  "score": 65 // an integer vibe rating from 1 to 100
}
Do not return any markdown formatting or extra text, just the raw JSON.`
          });
          const text = response.text || "";
          const jsonText = text.replace(/```json|```/g, "").trim();
          result = JSON.parse(jsonText);
        } catch (err) {
          console.warn("Gemini vibe debate failed, falling back to simulation:", err);
        }
      }
      if (!result) {
        const score = Math.floor(Math.random() * 40) + 50;
        const defaultSymbol = symbol || "the asset";
        result = {
          macro: `The strategy of '${prompt}' on ${defaultSymbol} aligns well with short-term trend dynamics. Recent order flow shows strong momentum accumulation. However, macro conditions (Fed liquidity profile, yield curve changes) suggest that correlation coefficients across the sector are elevated, meaning we are trading market beta more than specific alpha. Recommended to run this during high-liquidity sessions only.`,
          bear: `I see significant vulnerability here. The prompt assumes instant execution, but in reality, trading ${defaultSymbol} around these thresholds exposes us to severe slippage and front-running by high-frequency desks. Overhead structural resistance is dense, and any failure to hold the support triggers a cascade of margin liquidations. Volatility is clustering, which usually precedes a sharp downside reversion.`,
          risk: `From a risk standpoint, this setup needs strict parameter constraints. Given the volatility of ${defaultSymbol}, we recommend a maximum position size of 1.5% of equity. Use an ATR-based (Average Tree Range) trailing stop-loss of 2.1x ATR. This reduces noise checkouts while preserving a solid 1:2.5 Risk-to-Reward ratio. Drawdown limit should trigger automatic trading halts at 5% aggregate loss.`,
          consensus: `The committee rates this strategy as MODERATE. It captures core market imbalances but requires strict risk guidelines to avoid volatility traps. Optimized rule: Buy when volume exceeds 1.5x of the 20-period moving average and price is above the daily VWAP; exit with an 8-period EMA trailing stop.`,
          score
        };
      }
      res.json(result);
    } catch (error) {
      console.error("Vibe debate route failed:", error);
      res.status(500).json({ error: error.message || "Failed to debate vibe strategy" });
    }
  });
  let defiLlamaCache = null;
  let defiLlamaCacheTime = 0;
  async function getDefiLlamaPools() {
    const now = Date.now();
    if (defiLlamaCache && now - defiLlamaCacheTime < 10 * 60 * 1e3) {
      return defiLlamaCache;
    }
    try {
      const response = await fetch("https://api.llama.fi/pools");
      if (response.ok) {
        const data = await response.json();
        defiLlamaCache = data.data || [];
        defiLlamaCacheTime = now;
        return defiLlamaCache;
      }
    } catch (err) {
      console.error("Failed to fetch DefiLlama pools:", err);
    }
    return defiLlamaCache || [];
  }
  const CURATED_ASSETS = {
    "Stock_Monthly": ["O", "MAIN", "STAG", "EPR", "AGNC", "PSEC", "LTC", "GLAD", "SLG"],
    "Stock_Quarterly": ["AAPL", "MSFT", "JNJ", "PG", "KO", "PEP", "XOM", "CVX", "ABBV"],
    "Stock_Yearly": ["BMW.DE", "RIO.L", "MBG.DE", "SU.PA", "AIR.PA", "VOW3.DE", "BAS.DE"],
    "Crypto_Continuous": ["ETH-USD", "SOL-USD", "AVAX-USD", "ADA-USD", "DOT-USD"],
    "Crypto_Daily": ["USDC-USD", "USDT-USD", "DAI-USD", "AAVE-USD", "COMP-USD"],
    "Crypto_Weekly": ["ATOM-USD", "NEAR-USD", "MATIC-USD", "SNX-USD", "CRV-USD"]
  };
  const COUNTRY_SUFFIXES = {
    "US": "",
    "UK": ".L",
    "Canada": ".TO",
    "Germany": ".DE",
    "Australia": ".AX",
    "France": ".PA",
    "Japan": ".T"
  };
  app.get("/api/assets/search", async (req, res) => {
    try {
      let query = String(req.query.q || "");
      const type = String(req.query.type || "Stock");
      const country = String(req.query.country || "All");
      const frequency = String(req.query.frequency || "All");
      if (frequency !== "All" && !query) {
        const curatedKey = `${type}_${frequency}`;
        const symbols = CURATED_ASSETS[curatedKey] || [];
        const results2 = symbols.map((sym) => ({
          symbol: sym,
          name: sym,
          // Will be resolved by the quote endpoint
          exchange: "Curated",
          quoteType: type === "Crypto" ? "CRYPTOCURRENCY" : "EQUITY"
        }));
        return res.json({ quotes: results2 });
      }
      if (!query) {
        return res.json({ quotes: [] });
      }
      let searchQuery = query;
      if (type === "Stock" && country !== "All" && COUNTRY_SUFFIXES[country] !== void 0) {
        const suffix = COUNTRY_SUFFIXES[country];
        if (suffix && !searchQuery.includes(".")) {
          searchQuery = `${searchQuery}${suffix}`;
        }
      }
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchQuery)}`;
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
      });
      if (!response.ok) {
        throw new Error(`Yahoo Search failed: ${response.statusText}`);
      }
      const data = await response.json();
      let quotes = data.quotes || [];
      if (type === "Crypto") {
        quotes = quotes.filter((q) => q.quoteType === "CRYPTOCURRENCY" || q.symbol?.includes("-USD"));
      } else {
        quotes = quotes.filter((q) => q.quoteType === "EQUITY" || q.quoteType === "ETF");
      }
      const results = quotes.map((q) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        quoteType: q.quoteType
      }));
      res.json({ quotes: results });
    } catch (error) {
      console.error("Asset search failed:", error);
      res.status(500).json({ error: error.message || "Failed to search assets" });
    }
  });
  app.get("/api/assets/quote", async (req, res) => {
    try {
      const symbol = String(req.query.symbol || "");
      if (!symbol) {
        return res.status(400).json({ error: "Symbol is required" });
      }
      const yfUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
      const response = await fetch(yfUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
      });
      if (!response.ok) {
        throw new Error(`Yahoo Quote failed: ${response.statusText}`);
      }
      const yfData = await response.json();
      const results = yfData.quoteResponse?.result || [];
      if (results.length === 0) {
        return res.status(404).json({ error: `Symbol ${symbol} not found` });
      }
      const quote = results[0];
      const isCrypto = quote.quoteType === "CRYPTOCURRENCY" || symbol.includes("-USD");
      let yieldValue = 0;
      let sector = isCrypto ? "Staking" : "Financials";
      let safetyScore = 80;
      let payoutRatio = "50%";
      let frequency = "Quarterly";
      if (isCrypto) {
        const tokenSymbol = symbol.split("-")[0].toUpperCase();
        const pools = await getDefiLlamaPools();
        const tokenPools = pools.filter((p) => p.symbol?.toUpperCase() === tokenSymbol);
        if (tokenPools.length > 0) {
          const validPools = tokenPools.filter((p) => p.tvlUsd > 5e6);
          const bestPool = validPools.length > 0 ? validPools.sort((a, b) => b.apy - a.apy)[0] : tokenPools.sort((a, b) => b.apy - a.apy)[0];
          yieldValue = bestPool.apy;
          sector = bestPool.project ? `${bestPool.project} Staking` : "DeFi Staking";
          if (bestPool.tvlUsd > 1e8) {
            safetyScore = 95;
          } else if (bestPool.tvlUsd > 2e7) {
            safetyScore = 85;
          } else {
            safetyScore = 65;
          }
          payoutRatio = "N/A (PoS Emission)";
        } else {
          yieldValue = tokenSymbol === "ETH" ? 3.8 : tokenSymbol === "SOL" ? 6.4 : 5;
          safetyScore = 90;
          payoutRatio = "N/A";
        }
        frequency = "Monthly";
      } else {
        yieldValue = quote.trailingAnnualDividendYield ? quote.trailingAnnualDividendYield * 100 : 0;
        if (yieldValue === 0 && quote.dividendYield) {
          yieldValue = quote.dividendYield;
        }
        const pe = quote.trailingPE || quote.forwardPE;
        if (yieldValue > 15) {
          safetyScore = 40;
        } else if (yieldValue > 8) {
          safetyScore = 70;
        } else if (pe && pe > 25) {
          safetyScore = 80;
        } else {
          safetyScore = 90;
        }
        payoutRatio = pe ? `${Math.min(95, Math.max(30, Math.round(pe * 2.5)))}%` : "55%";
        frequency = "Quarterly";
      }
      const normalizedAsset = {
        symbol: quote.symbol,
        name: quote.shortname || quote.longname || quote.symbol,
        price: quote.regularMarketPrice || 0,
        change: quote.regularMarketChangePercent || 0,
        yield: yieldValue,
        frequency,
        safety: safetyScore,
        payoutRatio,
        growthStreak: isCrypto ? 0 : 5,
        sector,
        assetType: isCrypto ? "Crypto" : "Stock",
        summary: `Live data for ${quote.symbol} traded on ${quote.fullExchangeName || quote.exchange}. Current market capitalization is $${(quote.marketCap || 0).toLocaleString()}.`
      };
      res.json(normalizedAsset);
    } catch (error) {
      console.error("Asset quote fetch failed:", error);
      res.status(500).json({ error: error.message || "Failed to fetch asset quote" });
    }
  });
  const moversCache = {};
  app.get("/api/market/movers", async (req, res) => {
    try {
      const type = String(req.query.type || "Stock");
      const cacheKey = `movers:${type}`;
      const now = Date.now();
      const cached = moversCache[cacheKey];
      if (cached && now - cached.ts < 3 * 60 * 1e3) {
        return res.json({ movers: cached.data, cached: true });
      }
      let symbols = [];
      if (type === "Crypto") {
        symbols = [
          "BTC-USD",
          "ETH-USD",
          "SOL-USD",
          "XRP-USD",
          "DOGE-USD",
          "ADA-USD",
          "AVAX-USD",
          "LINK-USD",
          "DOT-USD",
          "MATIC-USD",
          "NEAR-USD",
          "ATOM-USD",
          "UNI-USD",
          "LTC-USD",
          "SUI-USD",
          "APT-USD",
          "ARB-USD",
          "OP-USD",
          "FIL-USD",
          "RENDER-USD"
        ];
      } else {
        try {
          const trendRes = await fetch(
            "https://query1.finance.yahoo.com/v1/finance/trending/US?count=25",
            { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" } }
          );
          if (trendRes.ok) {
            const trendData = await trendRes.json();
            const quotes = trendData?.finance?.result?.[0]?.quotes || [];
            symbols = quotes.map((q) => q.symbol).filter(Boolean);
          }
        } catch (e) {
          console.warn("Trending fetch failed, using fallback list:", e);
        }
        const dayTradeFavorites = [
          "NVDA",
          "TSLA",
          "AAPL",
          "AMD",
          "AMZN",
          "META",
          "GOOGL",
          "MSFT",
          "SPY",
          "QQQ",
          "PLTR",
          "SOFI",
          "NIO",
          "MARA",
          "COIN",
          "SMCI",
          "ARM",
          "MU",
          "NFLX",
          "CRM",
          "AVGO",
          "BA",
          "JPM",
          "V"
        ];
        const symbolSet = new Set(symbols);
        dayTradeFavorites.forEach((s) => symbolSet.add(s));
        symbols = [...symbolSet].slice(0, 30);
      }
      if (symbols.length === 0) {
        return res.json({ movers: [] });
      }
      const allMovers = [];
      const batchSize = 10;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const batchResults = await Promise.allSettled(
          batch.map(async (sym) => {
            const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
            const chartRes = await fetch(chartUrl, {
              headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
            });
            if (!chartRes.ok) return null;
            const chartData = await chartRes.json();
            const result = chartData?.chart?.result?.[0];
            if (!result) return null;
            const meta = result.meta || {};
            const quotes = result.indicators?.quote?.[0] || {};
            const timestamps = result.timestamp || [];
            const closes = quotes.close || [];
            const volumes = quotes.volume || [];
            const highs = quotes.high || [];
            const lows = quotes.low || [];
            const opens = quotes.open || [];
            const lastIdx = closes.length - 1;
            const prevIdx = Math.max(0, lastIdx - 1);
            const price = meta.regularMarketPrice || closes[lastIdx] || 0;
            const prevClose = meta.chartPreviousClose || meta.previousClose || closes[prevIdx] || price;
            const change = price - prevClose;
            const changePct = prevClose > 0 ? change / prevClose * 100 : 0;
            return {
              symbol: sym,
              name: meta.shortName || meta.longName || sym,
              price,
              change,
              changePct,
              volume: meta.regularMarketVolume || volumes[lastIdx] || 0,
              high: meta.regularMarketDayHigh || highs[lastIdx] || 0,
              low: meta.regularMarketDayLow || lows[lastIdx] || 0,
              marketCap: 0,
              exchange: meta.fullExchangeName || meta.exchangeName || "",
              quoteType: meta.instrumentType || "EQUITY"
            };
          })
        );
        batchResults.forEach((r) => {
          if (r.status === "fulfilled" && r.value && r.value.price > 0) {
            allMovers.push(r.value);
          }
        });
      }
      allMovers.sort((a, b) => {
        const absA = Math.abs(a.changePct);
        const absB = Math.abs(b.changePct);
        if (Math.abs(absA - absB) > 0.3) return absB - absA;
        return b.volume - a.volume;
      });
      moversCache[cacheKey] = { data: allMovers, ts: now };
      res.json({ movers: allMovers, cached: false });
    } catch (error) {
      console.error("Movers fetch failed:", error);
      res.status(500).json({ error: error.message || "Failed to fetch movers" });
    }
  });
  const candleCache = {};
  app.get("/api/market/candles", async (req, res) => {
    try {
      const symbol = String(req.query.symbol || "AAPL");
      const interval = String(req.query.interval || "5m");
      const range = String(req.query.range || "1d");
      const cacheKey = `${symbol}:${interval}:${range}`;
      const now = Date.now();
      const cached = candleCache[cacheKey];
      const ttl = interval === "1m" ? 3e4 : 6e4;
      if (cached && now - cached.ts < ttl) {
        return res.json({ candles: cached.data, cached: true });
      }
      const intervalMap = {
        "1m": "1m",
        "5m": "5m",
        "15m": "15m",
        "1h": "60m"
      };
      const yfInterval = intervalMap[interval] || "5m";
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${yfInterval}&range=${range}`;
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
      });
      if (!response.ok) throw new Error(`Yahoo chart failed: ${response.statusText}`);
      const data = await response.json();
      const result = data?.chart?.result?.[0];
      if (!result) return res.status(404).json({ error: "No chart data found" });
      const timestamps = result.timestamp || [];
      const quote = result.indicators?.quote?.[0] || {};
      const opens = quote.open || [];
      const highs = quote.high || [];
      const lows = quote.low || [];
      const closes = quote.close || [];
      const volumes = quote.volume || [];
      const candles = timestamps.map((t, i) => ({
        time: t,
        open: opens[i] ?? closes[i] ?? 0,
        high: highs[i] ?? closes[i] ?? 0,
        low: lows[i] ?? closes[i] ?? 0,
        close: closes[i] ?? 0,
        volume: volumes[i] ?? 0
      })).filter((c) => c.close > 0);
      candleCache[cacheKey] = { data: candles, ts: now };
      res.json({ candles, cached: false, symbol, interval, range });
    } catch (error) {
      console.error("Candle fetch failed:", error);
      res.status(500).json({ error: error.message || "Failed to fetch candles" });
    }
  });
  app.get("/api/market/price", async (req, res) => {
    try {
      const symbol = String(req.query.symbol || "AAPL");
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
      });
      if (!response.ok) throw new Error(`Yahoo chart failed: ${response.statusText}`);
      const data = await response.json();
      const result = data?.chart?.result?.[0];
      if (!result) return res.status(404).json({ error: "Symbol not found" });
      const meta = result.meta || {};
      const quotes = result.indicators?.quote?.[0] || {};
      const closes = quotes.close || [];
      const volumes = quotes.volume || [];
      const highs = quotes.high || [];
      const lows = quotes.low || [];
      const opens = quotes.open || [];
      const lastIdx = closes.length - 1;
      const price = meta.regularMarketPrice || closes[lastIdx] || 0;
      const prevClose = meta.chartPreviousClose || meta.previousClose || closes[Math.max(0, lastIdx - 1)] || price;
      const change = price - prevClose;
      const changePct = prevClose > 0 ? change / prevClose * 100 : 0;
      res.json({
        symbol: meta.symbol || symbol,
        name: meta.shortName || meta.longName || symbol,
        price,
        change,
        changePct,
        volume: meta.regularMarketVolume || volumes[lastIdx] || 0,
        high: meta.regularMarketDayHigh || highs[lastIdx] || 0,
        low: meta.regularMarketDayLow || lows[lastIdx] || 0,
        open: meta.regularMarketOpen || opens[lastIdx] || 0,
        prevClose,
        marketCap: 0,
        exchange: meta.fullExchangeName || meta.exchangeName || "",
        quoteType: meta.instrumentType || "EQUITY"
      });
    } catch (error) {
      console.error("Price fetch failed:", error);
      res.status(500).json({ error: error.message || "Failed to fetch price" });
    }
  });
  app.get("/api/lse/options", (req, res) => {
    const symbol = String(req.query.symbol || "AAPL");
    const currentPrice = 150;
    const mockOptions = [
      { strike: currentPrice * 1.05, expiry: "30 Days", premium: 2.45, impliedVol: 24.5 },
      { strike: currentPrice * 1.1, expiry: "30 Days", premium: 1.1, impliedVol: 22.1 },
      { strike: currentPrice * 1.15, expiry: "30 Days", premium: 0.45, impliedVol: 20.8 }
    ];
    res.json({ symbol, currentPrice, chain: mockOptions });
  });
  app.get("/api/lse/macro", (req, res) => {
    res.json({
      series: "US 10-Year Treasury Yield",
      data: Array.from({ length: 30 }, (_, i) => ({
        time: new Date(Date.now() - (30 - i) * 864e5).toISOString().split("T")[0],
        value: 4 + Math.sin(i * 0.2) * 0.5
      }))
    });
  });
  if (process.env.NODE_ENV !== "production") {
    const vite = await (0, import_vite.createServer)({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = import_path.default.join(process.cwd(), "dist");
    app.use(import_express.default.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(import_path.default.join(distPath, "index.html"));
    });
  }
  const httpServer = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  const wss = new import_ws.WebSocketServer({ server: httpServer, path: "/ws/marketdata" });
  wss.on("connection", (clientWs) => {
    const lseWs = new import_ws.WebSocket("wss://data-ws.londonstrategicedge.com");
    lseWs.on("open", () => {
      lseWs.send(JSON.stringify({
        action: "auth",
        api_key: process.env.LSE_API_KEY || "lse_live_mock"
      }));
    });
    lseWs.on("message", (data) => {
      if (clientWs.readyState === import_ws.WebSocket.OPEN) {
        clientWs.send(data.toString());
      }
    });
    clientWs.on("message", (data) => {
      if (lseWs.readyState === import_ws.WebSocket.OPEN) {
        lseWs.send(data.toString());
      }
    });
    clientWs.on("close", () => lseWs.close());
    lseWs.on("close", () => clientWs.close());
  });
}
startServer().catch((err) => {
  console.error("Server failed to bootstrap:", err);
});
//# sourceMappingURL=server.cjs.map
