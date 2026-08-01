import type { Express, Request, Response } from "express";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { Interface, JsonRpcProvider, formatUnits, getAddress, verifyMessage } from "ethers";
import { buildSettlementOwnershipMessage } from "../src/shared/settlementEvidence";

export const BSC_CHAIN_ID = 56;
export const BSC_USDT_ADDRESS = "0x55d398326f99059fF775485246999027B3197955";
export const BSC_USDT_DECIMALS = 18;

const TRANSFER_INTERFACE = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "dividendpro-3b397";
const BSC_RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org/";

export function hasMatchingUsdtTransfer(
  logs: ReadonlyArray<{ address: string; topics: ReadonlyArray<string>; data: string }>,
  expectedFrom: string,
  expectedTo: string,
  expectedBaseUnits: bigint,
): boolean {
  const normalizedFrom = getAddress(expectedFrom);
  const normalizedTo = getAddress(expectedTo);
  return logs.some((log) => {
    if (getAddress(log.address) !== getAddress(BSC_USDT_ADDRESS)) return false;
    try {
      const parsed = TRANSFER_INTERFACE.parseLog({ topics: [...log.topics], data: log.data });
      return parsed?.name === "Transfer"
        && getAddress(String(parsed.args.from)) === normalizedFrom
        && getAddress(String(parsed.args.to)) === normalizedTo
        && BigInt(parsed.args.value.toString()) === expectedBaseUnits;
    } catch {
      return false;
    }
  });
}

function getAdminApp() {
  return getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}

export async function authenticateFirebaseRequest(req: Request): Promise<DecodedIdToken> {
  const authorization = req.header("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error("AUTH_REQUIRED");
  return getAuth(getAdminApp()).verifyIdToken(match[1], true);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getTelegramConfig(): { botToken: string; chatId: string } | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.Telegram_Bot_Token;
  // The legacy name is read only by Node during migration; Vite's allowlist blocks it from client bundles.
  const chatId = process.env.TELEGRAM_CHAT_ID || process.env.Telegram_Chat_ID || process.env.VITE_TELEGRAM_CHAT_ID;
  return botToken && chatId ? { botToken, chatId } : null;
}

export async function sendTelegramHtml(text: string): Promise<boolean> {
  const config = getTelegramConfig();
  if (!config) return false;
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: config.chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  return response.ok;
}

function authFailure(res: Response): void {
  res.status(401).json({ error: "Authenticated Firebase session required." });
}

export function registerTruthLayerRoutes(app: Express): void {
  app.get("/api/truth/health", (_req, res) => {
    const mevLiveExecutionEnabled = process.env.MEV_LIVE_EXECUTION_ENABLED === "true";
    const mevExecutorConfigured = Boolean(
      process.env.MEV_KMS_KEY_VERSION
      && process.env.MEV_EXECUTION_SIGNER_ADDRESS
      && process.env.MEV_EXECUTOR_ADDRESS
      && process.env.MEV_ROUTER_ALLOWLIST
      && process.env.MEV_TOKEN_ALLOWLIST
      && process.env.MEV_PROFIT_RECIPIENT_ALLOWLIST,
    );
    res.json({
      ok: true,
      release: "truth-layer-v1",
      mode: mevLiveExecutionEnabled && mevExecutorConfigured ? "LIVE_CAPABLE" : "SIMULATION_ONLY",
      liveExecution: {
        enabled: mevLiveExecutionEnabled && mevExecutorConfigured,
        mevExecutorConfigured,
        settlementVerificationAvailable: true,
        settlementVerificationIsExecution: false,
        chainReceiptRequired: true,
        finalizedBlockRequired: true,
      },
      chainId: BSC_CHAIN_ID,
      token: BSC_USDT_ADDRESS,
      telegramConfigured: Boolean(getTelegramConfig()),
      evidenceStore: `firestore://${PROJECT_ID}/users/{uid}/settlements/{txHash}`,
    });
  });

  app.get("/api/telegram/status", async (req, res) => {
    try {
      await authenticateFirebaseRequest(req);
      res.json({ configured: Boolean(getTelegramConfig()), serverManaged: true });
    } catch {
      authFailure(res);
    }
  });

  app.post("/api/settlements/verify", async (req, res) => {
    try {
      const user = await authenticateFirebaseRequest(req);
      const txHash = String(req.body?.txHash || "");
      const expectedFrom = getAddress(String(req.body?.from || ""));
      const expectedTo = getAddress(String(req.body?.to || ""));
      const expectedBaseUnits = BigInt(String(req.body?.amountBaseUnits || "0"));
      const walletSignature = String(req.body?.walletSignature || "");
      if (!TX_HASH_PATTERN.test(txHash) || expectedBaseUnits <= 0n || !/^0x[0-9a-fA-F]{130}$/.test(walletSignature)) {
        return void res.status(400).json({ error: "Invalid settlement evidence request." });
      }

      const ownershipMessage = buildSettlementOwnershipMessage({
        uid: user.uid,
        txHash,
        from: expectedFrom,
        to: expectedTo,
        amountBaseUnits: expectedBaseUnits.toString(),
        chainId: BSC_CHAIN_ID,
      });
      if (getAddress(verifyMessage(ownershipMessage, walletSignature)) !== expectedFrom) {
        return void res.status(422).json({ error: "Wallet ownership signature does not match the transaction sender." });
      }

      const provider = new JsonRpcProvider(BSC_RPC_URL, BSC_CHAIN_ID, { staticNetwork: true });
      const [receipt, transaction, latestBlock, finalizedBlock] = await Promise.all([
        provider.getTransactionReceipt(txHash),
        provider.getTransaction(txHash),
        provider.getBlockNumber(),
        provider.getBlock("finalized").catch(() => null),
      ]);
      if (!receipt || !transaction) {
        return void res.status(409).json({ error: "Transaction is not yet available on BSC. Retry after confirmation." });
      }
      if (receipt.status !== 1) return void res.status(422).json({ error: "BSC transaction reverted." });
      if (!finalizedBlock) {
        return void res.status(503).json({ error: "BSC finalized-block evidence is unavailable. No alert was sent." });
      }
      if (receipt.blockNumber > finalizedBlock.number) {
        return void res.status(409).json({ error: "Transaction is confirmed but not finalized. Retry after BSC finality; no alert was sent." });
      }
      if (transaction.chainId !== BigInt(BSC_CHAIN_ID) || getAddress(transaction.from) !== expectedFrom) {
        return void res.status(422).json({ error: "Transaction sender or network does not match the signed request." });
      }
      if (!transaction.to || getAddress(transaction.to) !== getAddress(BSC_USDT_ADDRESS)) {
        return void res.status(422).json({ error: "Transaction did not call the canonical BSC USDT contract." });
      }

      if (!hasMatchingUsdtTransfer(receipt.logs, expectedFrom, expectedTo, expectedBaseUnits)) {
        return void res.status(422).json({ error: "No matching USDT Transfer event was found." });
      }

      const confirmations = Math.max(1, latestBlock - receipt.blockNumber + 1);
      const evidence = {
        schemaVersion: 1,
        environment: "LIVE" as const,
        verificationStatus: "FINALIZED_ON_CHAIN" as const,
        walletOwnershipProof: "EIP191_SIGNATURE_VERIFIED" as const,
        uid: user.uid,
        txHash: receipt.hash,
        chainId: BSC_CHAIN_ID,
        network: "BSC Mainnet",
        tokenSymbol: "USDT",
        tokenContract: getAddress(BSC_USDT_ADDRESS),
        tokenDecimals: BSC_USDT_DECIMALS,
        from: expectedFrom,
        to: expectedTo,
        amountBaseUnits: expectedBaseUnits.toString(),
        amount: formatUnits(expectedBaseUnits, BSC_USDT_DECIMALS),
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        transactionIndex: receipt.index,
        confirmations,
        finalizedBlockNumber: finalizedBlock.number,
        finalizedBlockHash: finalizedBlock.hash,
        explorerUrl: `https://bscscan.com/tx/${receipt.hash}`,
      };

      await getFirestore(getAdminApp())
        .doc(`users/${user.uid}/settlements/${receipt.hash.toLowerCase()}`)
        .set({ ...evidence, verifiedAt: FieldValue.serverTimestamp() }, { merge: false });

      await sendTelegramHtml(
        `✅ <b>FINALIZED BSC USDT SETTLEMENT</b>\nAmount: <b>${escapeHtml(evidence.amount)} USDT</b>\nFrom: <code>${escapeHtml(expectedFrom)}</code>\nTo: <code>${escapeHtml(expectedTo)}</code>\nBlock: ${receipt.blockNumber}\nFinalized through block: ${finalizedBlock.number}\n<a href="${evidence.explorerUrl}">Open immutable transaction evidence</a>`,
      ).catch(() => false);

      res.json({ evidence });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Verification failed";
      if (message === "AUTH_REQUIRED" || message.includes("Firebase ID token")) return void authFailure(res);
      res.status(400).json({ error: message });
    }
  });
}
