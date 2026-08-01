import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { Interface, Wallet, getAddress, parseUnits, verifyMessage } from "ethers";
import { BSC_USDT_ADDRESS, hasMatchingUsdtTransfer } from "../server/truthLayer";
import { isFinalizedReceiptReconciledProfit } from "../server/mevExecution";
import { executeAlphaTrade, type AlphaRecommendation } from "../src/services/quantAlphaEngine";
import { buildSettlementOwnershipMessage } from "../src/shared/settlementEvidence";

const from = "0x1111111111111111111111111111111111111111";
const to = "0x2222222222222222222222222222222222222222";
const amount = parseUnits("10000", 18);
const transferInterface = new Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

test("accepts only a matching canonical BSC USDT Transfer event", () => {
  const encoded = transferInterface.encodeEventLog("Transfer", [from, to, amount]);
  const logs = [{ address: BSC_USDT_ADDRESS, topics: encoded.topics, data: encoded.data }];

  assert.equal(hasMatchingUsdtTransfer(logs, from, to, amount), true);
  assert.equal(hasMatchingUsdtTransfer(logs, from, to, amount - 1n), false);
  assert.equal(hasMatchingUsdtTransfer(logs, from, "0x3333333333333333333333333333333333333333", amount), false);
  assert.equal(hasMatchingUsdtTransfer([{ ...logs[0], address: "0x4444444444444444444444444444444444444444" }], from, to, amount), false);
});

const recommendation: AlphaRecommendation = {
  id: "test",
  symbol: "TEST/USD",
  name: "Truth Test",
  category: "Crypto",
  convictionScore: 90,
  signalType: "STRONG_BUY",
  currentPrice: 100,
  entryTarget: 100,
  takeProfitTarget: 105,
  takeProfitPct: 5,
  stopLossTarget: 98,
  stopLossPct: 2,
  riskRewardRatio: 2.5,
  kellyPositionPct: 2,
  expectedReturnUsd: 50,
  expectedReturnBnb: 0.08,
  reasoning: "test",
  aiSwarmRating: "test",
  source: "test",
  updatedAt: "now",
};

test("Quant Alpha mainnet mode fails closed", () => {
  assert.throws(
    () => executeAlphaTrade(recommendation, "Manual", "mainnet"),
    /No live order router is configured/,
  );
});

test("paper execution cannot masquerade as a blockchain transaction", () => {
  const result = executeAlphaTrade(recommendation, "Manual", "paper", 0);
  assert.equal(result.environment, "SIMULATION");
  assert.equal(result.verificationStatus, "NOT_APPLICABLE");
  assert.equal(result.status, "OPEN");
  assert.equal(result.pnlUsd, 0);
  assert.match(result.txHash, /^SIM-/);
  assert.doesNotMatch(result.txHash, /^0x[0-9a-fA-F]{64}$/);
});

test("browser Telegram dispatch remains revoked and synthetic profit templates stay absent", () => {
  const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const telegramSource = readFileSync(new URL("../src/services/telegram.ts", import.meta.url), "utf8");
  const alphaSource = readFileSync(new URL("../src/components/QuantAlphaHub.tsx", import.meta.url), "utf8");
  const executionSource = readFileSync(new URL("../server/mevExecution.ts", import.meta.url), "utf8");
  const truthLayerSource = readFileSync(new URL("../server/truthLayer.ts", import.meta.url), "utf8");

  assert.match(appSource, /CLIENT_TELEGRAM_DISPATCH_REVOKED/);
  assert.doesNotMatch(telegramSource, /api\.telegram\.org\/bot|VITE_TELEGRAM_BOT_TOKEN/);
  assert.doesNotMatch(`${telegramSource}\n${truthLayerSource}`, /api\/notifications\/telegram|paper_alpha_trade|testTelegramConnection|notifyPaperAlphaTrade/);
  assert.doesNotMatch(alphaSource, /AUTONOMOUS BOT TRADE EXECUTED|NET REALIZED PROFIT|sendTelegramMessage/);
  assert.doesNotMatch(`${executionSource}\n${truthLayerSource}`, /MEV_EXECUTION_PRIVATE_KEY|new Wallet\(/);
  assert.match(`${executionSource}\n${truthLayerSource}`, /MEV_KMS_KEY_VERSION/);
  assert.match(truthLayerSource, /getBlock\("finalized"\)/);
});

test("Telegram profit eligibility requires consistent finalized receipt evidence", () => {
  const evidence = {
    terminalState: "FINALIZED_PROFIT",
    txHash: `0x${"12".repeat(32)}`,
    includedBlockNumber: 100,
    includedBlockHash: `0x${"34".repeat(32)}`,
    finalizedBlockNumber: 102,
    finalizedBlockHash: `0x${"56".repeat(32)}`,
    realizedProfitBaseUnits: "1000",
    error: null,
  };
  assert.equal(isFinalizedReceiptReconciledProfit({ canonical: evidence, regional: [evidence, { ...evidence }] }), true);
  assert.equal(isFinalizedReceiptReconciledProfit({
    canonical: evidence,
    regional: [evidence, { ...evidence, terminalState: "EVIDENCE_MISMATCH" }],
  }), false);
  assert.equal(isFinalizedReceiptReconciledProfit({
    canonical: evidence,
    regional: [{ ...evidence, finalizedBlockHash: null }],
  }), false);
});

test("settlement ownership proof binds Firebase uid and receipt fields to the sender wallet", async () => {
  const wallet = Wallet.createRandom();
  const input = {
    uid: "firebase-user-a",
    txHash: `0x${"ab".repeat(32)}`,
    from: wallet.address,
    to,
    amountBaseUnits: amount.toString(),
    chainId: 56,
  };
  const message = buildSettlementOwnershipMessage(input);
  const signature = await wallet.signMessage(message);

  assert.equal(getAddress(verifyMessage(message, signature)), getAddress(wallet.address));
  assert.notEqual(
    getAddress(verifyMessage(buildSettlementOwnershipMessage({ ...input, uid: "firebase-user-b" }), signature)),
    getAddress(wallet.address),
  );
});
