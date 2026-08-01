import crypto from "node:crypto";
import type { Express, Request } from "express";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import {
  Interface,
  JsonRpcProvider,
  getAddress,
  isHexString,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import { evaluateStoredPromotion, submitSignedExecutionToWorkers } from "./mevControl";
import { configuredKmsSigner } from "./kmsEvmSigner";
import { sendTelegramHtml } from "./truthLayer";

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "dividendpro-3b397";
const BSC_CHAIN_ID = 56;
const STRATEGY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const EXECUTOR_INTERFACE = new Interface([
  "function executeArbitrage((bytes32 executionId,address tokenIn,uint256 amountIn,address routerBuy,address routerSell,address[] buyPath,address[] sellPath,uint256 minProfit,address recipient,uint256 deadline) params) returns (uint256 profit)",
]);
const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

type WorkerExecutionResult = {
  canonical: Record<string, any>;
  regional: Record<string, any>[];
};

function positiveBigInt(value: unknown): bigint | null {
  try {
    const parsed = BigInt(String(value));
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

export function isFinalizedReceiptReconciledProfit(result: WorkerExecutionResult): boolean {
  const regional = Array.isArray(result?.regional) ? result.regional : [];
  const canonicalHash = String(result?.canonical?.txHash || "").toLowerCase();
  const canonicalProfit = positiveBigInt(result?.canonical?.realizedProfitBaseUnits);
  if (regional.length === 0 || !HASH_PATTERN.test(canonicalHash) || canonicalProfit === null) return false;

  return regional.every(evidence => {
    const includedBlock = Number(evidence?.includedBlockNumber);
    const finalizedBlock = Number(evidence?.finalizedBlockNumber);
    return evidence?.terminalState === "FINALIZED_PROFIT"
      && String(evidence?.txHash || "").toLowerCase() === canonicalHash
      && HASH_PATTERN.test(String(evidence?.includedBlockHash || ""))
      && HASH_PATTERN.test(String(evidence?.finalizedBlockHash || ""))
      && Number.isSafeInteger(includedBlock)
      && Number.isSafeInteger(finalizedBlock)
      && finalizedBlock >= includedBlock
      && positiveBigInt(evidence?.realizedProfitBaseUnits) === canonicalProfit
      && !evidence?.error;
  });
}

function getAdminApp() {
  return getApps()[0] || initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
}

function internalTokenMatches(req: Request): boolean {
  const expected = process.env.MEV_EXECUTOR_INTERNAL_TOKEN || "";
  const supplied = req.header("x-mev-internal-token") || "";
  if (expected.length < 32 || expected.length !== supplied.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

function allowedAddresses(envName: string): Set<string> {
  return new Set(String(process.env[envName] || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => getAddress(value).toLowerCase()));
}

function requireAllowed(value: unknown, allowlist: Set<string>, label: string): string {
  const address = getAddress(String(value || ""));
  if (!allowlist.has(address.toLowerCase())) throw new Error(`${label} is not server-allowlisted.`);
  return address;
}

function positiveBaseUnits(value: unknown, label: string): bigint {
  const parsed = BigInt(String(value || "0"));
  if (parsed <= 0n) throw new Error(`${label} must be a positive base-unit integer.`);
  return parsed;
}

async function acquireNonceLease(
  provider: JsonRpcProvider,
  signerAddress: string,
  leaseId: string,
): Promise<{ nonce: number; release: () => Promise<void> }> {
  const db = getFirestore(getAdminApp());
  const ref = db.doc(`_system/mevNonceLeases/${signerAddress.toLowerCase()}`);
  const chainNonce = await provider.getTransactionCount(signerAddress, "pending");
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.data();
    const leaseUntilMs = current?.leaseUntil?.toMillis?.() || 0;
    if (current?.leaseId && leaseUntilMs > Date.now()) {
      throw new Error("Execution signer nonce is already leased by another worker.");
    }
    transaction.set(ref, {
      leaseId,
      nonce: chainNonce,
      leaseUntil: new Date(Date.now() + 60_000),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
  return {
    nonce: chainNonce,
    release: async () => {
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(ref);
        if (snapshot.data()?.leaseId === leaseId) {
          transaction.set(ref, {
            leaseId: null,
            leaseUntil: new Date(0),
            releasedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }
      });
    },
  };
}

async function recordExecution(
  uid: string,
  strategyId: string,
  executionId: string,
  result: WorkerExecutionResult,
): Promise<boolean> {
  const db = getFirestore(getAdminApp());
  const strategyRef = db.doc(`users/${uid}/mevStrategies/${strategyId}`);
  const executionRef = db.doc(`users/${uid}/mevExecutions/${executionId}`);
  const isFinalizedProfit = isFinalizedReceiptReconciledProfit(result);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(strategyRef);
    const strategy = snapshot.data();
    if (!strategy?.evidence || !strategy?.mode) throw new Error("Strategy promotion evidence disappeared.");
    const terminalState = String(result.canonical.terminalState || "EVIDENCE_MISMATCH");
    const nextEvidence = {
      ...strategy.evidence,
      finalizedCanaryExecutions: strategy.mode === "CANARY_LIVE" && isFinalizedProfit
        ? Number(strategy.evidence.finalizedCanaryExecutions || 0) + 1
        : Number(strategy.evidence.finalizedCanaryExecutions || 0),
      canaryEvidenceFailures: strategy.mode === "CANARY_LIVE" && !isFinalizedProfit
        ? Number(strategy.evidence.canaryEvidenceFailures || 0) + 1
        : Number(strategy.evidence.canaryEvidenceFailures || 0),
    };
    transaction.create(executionRef, {
      schemaVersion: 1,
      strategyId,
      canonical: result.canonical,
      regional: result.regional,
      recordedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(strategyRef, {
      evidence: nextEvidence,
      mode: isFinalizedProfit ? strategy.mode : "PAUSED",
      lastExecutionId: executionId,
      lastExecutionState: terminalState,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  });
  return isFinalizedProfit;
}

export function registerMevExecutionRoutes(app: Express): void {
  app.post("/api/mev/internal/execute", async (req, res) => {
    if (!internalTokenMatches(req)) return void res.status(401).json({ error: "Internal executor token required." });

    let releaseLease: (() => Promise<void>) | null = null;
    try {
      const uid = String(req.body?.uid || "");
      const strategyId = String(req.body?.strategyId || "");
      if (!uid || uid.length > 128 || !STRATEGY_ID_PATTERN.test(strategyId)) {
        throw new Error("Invalid uid or strategyId.");
      }

      // This transition is automatic: no mode or evidence is accepted from the
      // caller. Both are read from server-owned Firestore state.
      await evaluateStoredPromotion(uid, strategyId);
      const db = getFirestore(getAdminApp());
      const strategy = (await db.doc(`users/${uid}/mevStrategies/${strategyId}`).get()).data();
      if (!strategy || !["CANARY_LIVE", "LIVE"].includes(strategy.mode)) {
        return void res.status(409).json({ error: "Strategy has not passed the automatic mainnet promotion gate." });
      }

      const rpcUrl = process.env.BSC_RPC_URL;
      const executorAddress = process.env.MEV_EXECUTOR_ADDRESS;
      if (!rpcUrl || !executorAddress) {
        throw new Error("Server-side BSC signer or executor contract is not configured.");
      }
      const provider = new JsonRpcProvider(rpcUrl, BSC_CHAIN_ID, { staticNetwork: true });
      if ((await provider.getNetwork()).chainId !== 56n) throw new Error("Signer RPC is not BSC mainnet chain 56.");
      const kmsSigner = configuredKmsSigner();
      const signerAddress = await kmsSigner.getAddress();
      const executor = getAddress(executorAddress);
      if (await provider.getCode(executor) === "0x") throw new Error("Configured executor has no deployed bytecode.");

      const routerAllowlist = allowedAddresses("MEV_ROUTER_ALLOWLIST");
      const tokenAllowlist = allowedAddresses("MEV_TOKEN_ALLOWLIST");
      const recipientAllowlist = allowedAddresses("MEV_PROFIT_RECIPIENT_ALLOWLIST");
      const tokenIn = requireAllowed(req.body?.route?.tokenIn, tokenAllowlist, "tokenIn");
      const routerBuy = requireAllowed(req.body?.route?.routerBuy, routerAllowlist, "routerBuy");
      const routerSell = requireAllowed(req.body?.route?.routerSell, routerAllowlist, "routerSell");
      if (routerBuy === routerSell) throw new Error("Buy and sell routers must differ.");
      const recipient = requireAllowed(req.body?.route?.recipient, recipientAllowlist, "profit recipient");
      const amountIn = positiveBaseUnits(req.body?.route?.amountInBaseUnits, "amountInBaseUnits");
      const minProfit = positiveBaseUnits(req.body?.route?.minimumProfitBaseUnits, "minimumProfitBaseUnits");
      const buyPath = (req.body?.route?.buyPath || []).map((value: unknown) => requireAllowed(value, tokenAllowlist, "buy path token"));
      const sellPath = (req.body?.route?.sellPath || []).map((value: unknown) => requireAllowed(value, tokenAllowlist, "sell path token"));
      if (buyPath.length !== 2 || sellPath.length !== 2 || buyPath[0] !== tokenIn
          || buyPath[1] === tokenIn
          || sellPath.at(-1) !== tokenIn || buyPath.at(-1) !== sellPath[0]) {
        throw new Error("Arbitrage paths are disconnected or do not round-trip tokenIn.");
      }

      const executionId = crypto.randomUUID();
      const executionIdHash = keccak256(toUtf8Bytes(executionId));
      const deadline = Math.floor(Date.now() / 1000) + 15;
      const data = EXECUTOR_INTERFACE.encodeFunctionData("executeArbitrage", [
        {
          executionId: executionIdHash,
          tokenIn,
          amountIn,
          routerBuy,
          routerSell,
          buyPath,
          sellPath,
          minProfit,
          recipient,
          deadline,
        },
      ]);

      // The canonical node simulation is mandatory even if a relay also
      // simulates the bundle.
      const simulationResult = await provider.call({ from: signerAddress, to: executor, data });
      const [gasLimitEstimate, feeData, currentBlock, currentBlockHeader] = await Promise.all([
        provider.estimateGas({ from: signerAddress, to: executor, data }),
        provider.getFeeData(),
        provider.getBlockNumber(),
        provider.getBlock("latest"),
      ]);
      if (!feeData.gasPrice) throw new Error("BSC RPC returned no legacy gas price.");
      const maxGasLimit = BigInt(process.env.MEV_MAX_GAS_LIMIT || "1200000");
      const gasLimit = gasLimitEstimate * 120n / 100n;
      if (gasLimit > maxGasLimit) throw new Error("Estimated gas exceeds the server cap.");

      const lease = await acquireNonceLease(provider, signerAddress, executionId);
      releaseLease = lease.release;
      const signedTransaction = await kmsSigner.signTransaction({
        chainId: BSC_CHAIN_ID,
        type: 0,
        nonce: lease.nonce,
        to: executor,
        value: 0,
        data,
        gasLimit,
        gasPrice: feeData.gasPrice,
      });
      if (!isHexString(signedTransaction)) throw new Error("Signer did not return transaction bytes.");

      const triggerRawTransaction = String(req.body?.triggerRawTransaction || "");
      const rawTransactions = triggerRawTransaction
        ? [triggerRawTransaction, signedTransaction]
        : [signedTransaction];
      const executionTransactionIndex = rawTransactions.length - 1;
      const targetBlock = (await provider.getBlockNumber()) + 1;
      const serverOpportunity = structuredClone(req.body?.opportunity || {});
      if (!serverOpportunity.features || typeof serverOpportunity.features !== "object") {
        throw new Error("Scanner opportunity features are missing.");
      }
      // A scanner cannot self-declare confidence. The calibrated probability is
      // replaced with the current server-owned replay value.
      serverOpportunity.features.calibratedProbabilityPpm = Number(
        strategy.evidence.calibratedProbabilityPpm || 0,
      );
      serverOpportunity.observedAt = new Date().toISOString();
      serverOpportunity.simulation = {
        success: true,
        stateBlock: currentBlockHeader?.number ?? currentBlock,
        stateBlockHash: currentBlockHeader?.hash || "",
        callResultHash: keccak256(simulationResult),
        protectedRoute: true,
      };
      const payload = {
        executionId,
        mode: strategy.mode,
        opportunity: serverOpportunity,
        evidenceWindow: strategy.evidence,
        rawTransactions,
        executionTransactionIndex,
        targetBlock,
        expiresAt: new Date((deadline + 10) * 1000).toISOString(),
        expected: {
          sender: signerAddress,
          executor,
          calldataHash: keccak256(data),
          executionIdHash,
          profitToken: tokenIn,
          profitRecipient: recipient,
          minimumProfitBaseUnits: minProfit.toString(),
        },
      };
      const result = await submitSignedExecutionToWorkers(payload);
      const isFinalizedProfit = await recordExecution(uid, strategyId, executionId, result as WorkerExecutionResult);

      if (isFinalizedProfit) {
        await sendTelegramHtml(
          `✅ <b>FINALIZED BSC MEV EXECUTION</b>\n` +
          `Strategy: ${strategyId}\nExecution: ${executionId}\n` +
          `Transaction: ${String(result.canonical.txHash || "")}\n` +
          `Realized base-unit profit: ${String(result.canonical.realizedProfitBaseUnits || "0")}\n` +
          `The receipt and ArbitrageExecuted event were reconciled at BSC finalized state.`,
        );
        // Re-evaluate automatically; the 20th successful canary can promote to LIVE.
        await evaluateStoredPromotion(uid, strategyId);
      }

      res.json({ executionId, result, stored: true });
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : "MEV execution failed." });
    } finally {
      if (releaseLease) await releaseLease().catch(() => undefined);
    }
  });
}
