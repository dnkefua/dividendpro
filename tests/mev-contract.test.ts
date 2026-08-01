import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Interface, id, keccak256, toUtf8Bytes } from "ethers";

const executorAbi = new Interface([
  "function executeArbitrage((bytes32 executionId,address tokenIn,uint256 amountIn,address routerBuy,address routerSell,address[] buyPath,address[] sellPath,uint256 minProfit,address recipient,uint256 deadline) params) returns (uint256 profit)",
  "event ArbitrageExecuted(bytes32 indexed executionId,address indexed profitToken,address indexed recipient,uint256 amountIn,uint256 profit)",
]);

test("server signer ABI round-trips the constrained atomic route", () => {
  const tokenIn = "0x1111111111111111111111111111111111111111";
  const tokenOut = "0x2222222222222222222222222222222222222222";
  const routerBuy = "0x3333333333333333333333333333333333333333";
  const routerSell = "0x4444444444444444444444444444444444444444";
  const recipient = "0x5555555555555555555555555555555555555555";
  const executionId = keccak256(toUtf8Bytes("test-execution"));
  const data = executorAbi.encodeFunctionData("executeArbitrage", [{
    executionId,
    tokenIn,
    amountIn: 1_000_000n,
    routerBuy,
    routerSell,
    buyPath: [tokenIn, tokenOut],
    sellPath: [tokenOut, tokenIn],
    minProfit: 10_000n,
    recipient,
    deadline: 2_000_000_000,
  }]);
  const decoded = executorAbi.decodeFunctionData("executeArbitrage", data)[0];
  assert.equal(decoded.executionId, executionId);
  assert.equal(decoded.tokenIn.toLowerCase(), tokenIn.toLowerCase());
  assert.equal(decoded.minProfit, 10_000n);
  assert.deepEqual([...decoded.buyPath].map(String), [tokenIn, tokenOut]);
  assert.deepEqual([...decoded.sellPath].map(String), [tokenOut, tokenIn]);
});

test("Rust reconciler and Solidity executor commit to the same event signature", () => {
  const eventSignature = "ArbitrageExecuted(bytes32,address,address,uint256,uint256)";
  const rustSource = readFileSync(new URL("../native/src/reconcile.rs", import.meta.url), "utf8");
  const soliditySource = readFileSync(new URL("../contracts/VerifiedArbitrageExecutor.sol", import.meta.url), "utf8");
  assert.equal(executorAbi.getEvent("ArbitrageExecuted")?.topicHash, id(eventSignature));
  assert.match(rustSource, new RegExp(eventSignature.replace(/[()]/g, "\\$&")));
  assert.match(soliditySource, /require\(inputAfter >= inputBefore \+ params\.minProfit/);
  assert.match(soliditySource, /allowedRouters\[params\.routerBuy\]/);
});

test("Firestore clients cannot write MEV promotion or execution evidence", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/mevStrategies\/\{strategyId\}[\s\S]*?allow write: if false;/);
  assert.match(rules, /match \/mevExecutions\/\{executionId\}[\s\S]*?allow write: if false;/);
});
