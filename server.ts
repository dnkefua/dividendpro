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
