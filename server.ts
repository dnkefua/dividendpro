import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

dotenv.config();

const PORT = 3000;

// Lazy-initialize GoogleGenAI to prevent crashing on boot if key is missing
let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  const isVertex = process.env.GCP_PROJECT_ID || process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!aiClient) {
    if (key) {
      aiClient = new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    } else if (isVertex) {
      // Initialize Vertex AI on GCP using default credentials
      aiClient = new GoogleGenAI({});
    } else {
      console.warn("GEMINI_API_KEY is missing. Initializing with local dev key to prevent crash on boot.");
      aiClient = new GoogleGenAI({
        apiKey: "AIzaSyD-mockKeyForLocalBootstrapping"
      });
    }
  }
  return aiClient;
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
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

      const systemInstruction = isCrypto 
        ? "You are an elite, highly conservative decentralized finance (DeFi) risk officer and blockchain protocol auditor. You write with clinical, highly structured, objective, and authoritative blockchain and financial precision."
        : "You are an elite, highly conservative financial analyst and dividend safety expert. You write with clinical, highly structured, objective, and authoritative financial precision.";

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: contentPrompt,
        config: {
          systemInstruction,
        },
      });

      res.json({ analysis: response.text });
    } catch (error: any) {
      console.error("Gemini analysis failed:", error);
      res.status(500).json({ error: error.message || "Failed to generate AI analysis." });
    }
  });

  // General query helper for global chatbot
  app.post("/api/gemini/chat", async (req, res) => {
    try {
      const { message } = req.body;
      const ai = getAiClient();

      const chat = ai.chats.create({
        model: "gemini-3.5-flash",
        config: {
          systemInstruction: "You are the Lumina Finance DividendPro AI Assistant. You help users analyze high-yield stock lists, calculate hypothetical compound growth of their portfolio ($482,910.42 yielding ~5%), identify potential dividend traps, and provide intelligent forecasting based on standard financial models. Keep answers clean, structured, and professional.",
        }
      });

      const response = await chat.sendMessage({ message });
      res.json({ text: response.text });
    } catch (error: any) {
      console.error("Gemini chat failed:", error);
      res.status(500).json({ error: error.message || "Failed to communicate with AI Assistant." });
    }
  });

  // Simple in-memory cache for DefiLlama pools (since they are large and update slowly)
  let defiLlamaCache: any = null;
  let defiLlamaCacheTime = 0;

  async function getDefiLlamaPools() {
    const now = Date.now();
    // Cache for 10 minutes to prevent rate limits and speed up calls
    if (defiLlamaCache && now - defiLlamaCacheTime < 10 * 60 * 1000) {
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

  // Live asset search proxy
  app.get("/api/assets/search", async (req, res) => {
    try {
      const query = req.query.q || "";
      const type = req.query.type || "Stock"; // "Stock" | "Crypto"
      if (!query) {
        return res.json({ quotes: [] });
      }

      // Fetch from Yahoo Finance Search
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(String(query))}`;
      const response = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
      });
      if (!response.ok) {
        throw new Error(`Yahoo Search failed: ${response.statusText}`);
      }
      const data = await response.json();
      
      // Filter based on selected tab (Stock vs Crypto)
      let quotes = data.quotes || [];
      if (type === "Crypto") {
        quotes = quotes.filter((q: any) => q.quoteType === "CRYPTOCURRENCY" || q.symbol?.includes("-USD"));
      } else {
        quotes = quotes.filter((q: any) => q.quoteType === "EQUITY" || q.quoteType === "ETF");
      }

      // Standardize response
      const results = quotes.map((q: any) => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || q.symbol,
        exchange: q.exchange,
        quoteType: q.quoteType
      }));

      res.json({ quotes: results });
    } catch (error: any) {
      console.error("Asset search failed:", error);
      res.status(500).json({ error: error.message || "Failed to search assets" });
    }
  });

  // Live asset quote details & yield fetcher
  app.get("/api/assets/quote", async (req, res) => {
    try {
      const symbol = String(req.query.symbol || "");
      if (!symbol) {
        return res.status(400).json({ error: "Symbol is required" });
      }

      // Query Yahoo Finance Quote
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
      
      // Calculate yield
      if (isCrypto) {
        const tokenSymbol = symbol.split("-")[0].toUpperCase();
        const pools = await getDefiLlamaPools();
        
        const tokenPools = pools.filter((p: any) => p.symbol?.toUpperCase() === tokenSymbol);
        if (tokenPools.length > 0) {
          const validPools = tokenPools.filter((p: any) => p.tvlUsd > 5000000);
          const bestPool = validPools.length > 0 
            ? validPools.sort((a: any, b: any) => b.apy - a.apy)[0]
            : tokenPools.sort((a: any, b: any) => b.apy - a.apy)[0];
          
          yieldValue = bestPool.apy;
          sector = bestPool.project ? `${bestPool.project} Staking` : "DeFi Staking";
          
          if (bestPool.tvlUsd > 100000000) {
            safetyScore = 95;
          } else if (bestPool.tvlUsd > 20000000) {
            safetyScore = 85;
          } else {
            safetyScore = 65;
          }
          payoutRatio = "N/A (PoS Emission)";
        } else {
          yieldValue = tokenSymbol === "ETH" ? 3.8 : tokenSymbol === "SOL" ? 6.4 : 5.0;
          safetyScore = 90;
          payoutRatio = "N/A";
        }
        frequency = "Monthly";
      } else {
        yieldValue = quote.trailingAnnualDividendYield ? (quote.trailingAnnualDividendYield * 100) : 0;
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
    } catch (error: any) {
      console.error("Asset quote fetch failed:", error);
      res.status(500).json({ error: error.message || "Failed to fetch asset quote" });
    }
  });

  // Vite Middleware for Development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Server failed to bootstrap:", err);
});
