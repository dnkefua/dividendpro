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
  assert.match(soliditySource, /isRouterActive\(params\.routerBuy\)/);
});

/// The server encodes `executeArbitrage` from a hand-written signature. If the
/// Solidity struct's field ORDER changes, the ABI encoder silently produces a
/// valid-looking call with the arguments transposed — the failure mode that
/// costs money rather than throwing.
test("server ABI tuple order matches the Solidity struct field order", () => {
  const source = readFileSync(new URL("../contracts/VerifiedArbitrageExecutor.sol", import.meta.url), "utf8");
  const structBody = source.match(/struct ArbitrageParams \{([\s\S]*?)\}/)?.[1];
  assert.ok(structBody, "ArbitrageParams struct must be findable");
  const solidityFields = [...structBody.matchAll(/^\s*[\w[\]]+\s+(\w+);/gm)].map(m => m[1]);

  const serverSource = readFileSync(new URL("../server/mevExecution.ts", import.meta.url), "utf8");
  const serverTuple = serverSource.match(/function executeArbitrage\(\(([^)]*)\)/)?.[1];
  assert.ok(serverTuple, "server executeArbitrage signature must be findable");
  const serverFields = serverTuple.split(",").map(part => part.trim().split(/\s+/).pop());

  assert.deepEqual(serverFields, solidityFields, "server ABI drifted from the contract struct");
  // And the copy this test file uses must agree with both.
  const localTuple = executorAbi.getFunction("executeArbitrage")?.inputs[0];
  assert.deepEqual(localTuple?.components?.map(c => c.name), solidityFields);
});

test("router allowlist delay is enforced, not just the recipient one", () => {
  const source = readFileSync(new URL("../contracts/VerifiedArbitrageExecutor.sol", import.meta.url), "utf8");
  // Both propose paths must set a future activation, and execution must gate on
  // the active check rather than mere presence in the mapping.
  assert.match(source, /function proposeRouter[\s\S]*?block\.timestamp \+ ALLOWLIST_DELAY/);
  assert.match(source, /function isRouterActive[\s\S]*?activeFrom != 0 && block\.timestamp >= activeFrom/);
});

test("executor constrains every path by which value can leave the contract", () => {
  const source = readFileSync(new URL("../contracts/VerifiedArbitrageExecutor.sol", import.meta.url), "utf8");

  // Profit recipient is enforced on chain, not trusted from the control plane.
  assert.match(source, /require\(isRecipientActive\(params\.recipient\), "RECIPIENT_NOT_ALLOWED"\)/);
  // Recovery is the other exit; it must be constrained identically, otherwise it
  // is the shortest path from control-plane compromise to a full drain.
  assert.match(source, /require\(isRecipientActive\(to\), "RECIPIENT_NOT_ALLOWED"\)/);
  // Per-token notional ceiling, with an unset ceiling denying the token.
  assert.match(source, /require\(amountCap != 0 && params\.amountIn <= amountCap, "AMOUNT_ABOVE_CAP"\)/);
});

test("allowlist delay is immutable and revocation is never delayed", () => {
  const source = readFileSync(new URL("../contracts/VerifiedArbitrageExecutor.sol", import.meta.url), "utf8");

  // A settable delay would let a compromised owner key shorten it to zero,
  // which is the whole property this contract leans on.
  assert.match(source, /uint256 public constant ALLOWLIST_DELAY = 24 hours;/);
  assert.doesNotMatch(source, /function set\w*Delay/i, "delay must not be settable");

  // Additions wait; revocations take effect immediately.
  for (const fn of ["proposeRouter", "proposeRecipient"]) {
    assert.match(source, new RegExp(`function ${fn}[\\s\\S]*?block\\.timestamp \\+ ALLOWLIST_DELAY`));
  }
  for (const [fn, slot] of [["revokeRouter", "routerActiveFrom"], ["revokeRecipient", "recipientActiveFrom"]]) {
    assert.match(source, new RegExp(`function ${fn}\\(address \\w+\\) external onlyOwner \\{\\s*${slot}\\[\\w+\\] = 0;`));
  }
});

test("Firestore clients cannot write MEV promotion or execution evidence", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  assert.match(rules, /match \/mevStrategies\/\{strategyId\}[\s\S]*?allow write: if false;/);
  assert.match(rules, /match \/mevExecutions\/\{executionId\}[\s\S]*?allow write: if false;/);
});
