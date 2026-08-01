# Verified arbitrage executor

`VerifiedArbitrageExecutor.sol` is the only contract callable by the first live
MEV path. It is intentionally narrow:

- owner-only execution;
- explicit router allowlist;
- two connected V2 swap paths;
- no arbitrary call target or calldata;
- transaction-wide revert unless the starting token balance increases by
  `minProfit`;
- a uniquely indexed `ArbitrageExecuted` event used by the Rust reconciler;
- profit is transferred to the configured recipient only after the invariant
  passes.

The contract is source-complete but not deployed. Deployment, router
allowlisting, funding, and mainnet verification are part of the billing-gated
canary smoke test. An independent smart-contract security review is required
before increasing the USD 25 canary cap.
