# DividendPro Production Memory

Last reconciled: 2026-08-02

## Product objective

DividendPro uses historical and current BSC market data to evaluate strategies in
simulation. A strategy can promote automatically from `SIMULATION` to a capped
`CANARY_LIVE` mainnet state only when the statistical, risk, data-freshness,
execution-readiness, and protected-route gates all pass. It can promote from
canary to `LIVE` only after finalized mainnet evidence confirms that execution
matches the simulation assumptions.

The 85% requirement means both a calibrated probability of positive net profit
of at least 0.85 and a one-sided 95% Wilson lower bound of at least 0.85 over at
least 200 time-ordered, out-of-sample observations. It is not a UI confidence
label and never bypasses operational gates.

## Delivered truth layer

- Simulation, canary, and live states are explicit. Simulated identifiers use
  `SIM-*` and cannot be represented as chain transactions or realized profit.
- Synthetic Telegram profit templates and browser Telegram dispatch were
  removed. The retired `/api/notifications/telegram` route is absent.
- Telegram dispatch is server-only. Secret Manager secret
  `telegram-bot-token`, pinned to version `1`, is bound to the Cloud Run service;
  the authorized destination is chat `6044637051`.
- Telegram trade alerts are eligible only after persisted, finalized,
  receipt-reconciled evidence. Cross-region evidence mismatch, absent finality,
  a reverted receipt, or non-positive reconciled profit suppresses the alert and
  prevents a successful canary count.
- BSC USDT settlement verification independently checks Firebase identity,
  EIP-191 wallet ownership, chain 56, transaction sender, canonical USDT token,
  exact recipient/value `Transfer` event, status-1 receipt, and finalized block
  inclusion before evidence storage and notification.
- Firestore client access is scoped per Firebase user. Settlement, strategy, and
  MEV execution evidence is server-written and browser-read-only.

## Delivered MEV execution foundation

- Rust scanning, replay, policy, geographic submission, and finalized receipt
  reconciliation are under `native/`.
- The C++ fixed-point risk kernel applies profitability, probability, latency,
  freshness, liquidity, notional, and simulation gates without floating-point
  money calculations.
- The Node control plane stores server-derived replay and execution evidence,
  owns promotion decisions, enforces allowlists, and fails closed when deployment
  readiness is incomplete.
- `contracts/VerifiedArbitrageExecutor.sol` is the sole coded live path: an
  allowlisted atomic two-router V2 arbitrage that reverts below minimum profit.
- Tokyo, Frankfurt, and Northern Virginia worker infrastructure has been
  provisioned. Workers remain stopped/execution-disabled pending the production
  canary prerequisites.

## Production security state

- Google Cloud KMS key version:
  `projects/dividendpro-3b397/locations/us-east4/keyRings/dividendpro-production/cryptoKeys/mev-executor-signer/cryptoKeyVersions/1`
- Derived BSC signer: `0xF69bf03d13690248C4E0c7f4aB2b72eACf72E4df`
- The secp256k1 private key is non-exportable and HSM-backed. Only the Cloud Run
  service account has signer/verifier permission on the specific key.
- Runtime signing validates KMS CRC32C checks, derives and pins the public
  address, recovers the transaction sender, and accepts only legacy BSC chain-56
  transactions.
- Previously pasted Telegram tokens and private keys are compromised and must
  never be reused. No chat-exposed private key is part of production.

## Current deployment

- Google Cloud project: `dividendpro-3b397`
- Cloud Run service/region: `dividendpro-app` / `us-east4`
- Verified revision before this commit: `dividendpro-app-00008-dgh`, 100% traffic
- Runtime service account:
  `dividendpro-control-plane@dividendpro-3b397.iam.gserviceaccount.com`
- Health state before this commit: `SIMULATION_ONLY`, Telegram configured, KMS
  signer verified, live execution disabled, executor not configured.
- No real coin was moved and no production MEV trade was executed during this
  release work.

## Next production milestone

Complete these in order before enabling real-coin execution:

1. Audit and deploy `VerifiedArbitrageExecutor` on BSC mainnet with the KMS
   signer as the authorized owner/operator and verify the source on BscScan.
2. Configure the deployed executor address plus audited router, token, and
   profit-recipient allowlists. Do not reuse unverified executor addresses.
3. Configure authenticated private relay/builder access and chain-56 RPC on all
   three geographic workers; keep public-mempool fallback prohibited.
4. Fund only the KMS-derived signer with the minimum BNB required for the capped
   canary. Keep the profit recipient separate and never place a raw private key
   in Cloud Run, source control, browser storage, or chat.
5. Start the workers and verify region health, clock synchronization, latency,
   idempotent raw-transaction fan-out, nonce leases, and kill switches.
6. Ingest at least 200 genuine time-ordered historical/current observations and
   demonstrate every statistical and risk gate, including Wilson lower bound,
   calibration, after-cost profit factor, drawdown, freshness, and atomic
   simulation.
7. Run one explicitly authorized mainnet canary capped at USD 25. Reconcile its
   receipt, executor event, finalized block, balances/profit, and Firestore
   evidence; verify that exactly one receipt-backed Telegram alert is emitted.
8. Require 20 finalized successful canary executions with zero evidence failures
   before automatic promotion to `LIVE`. Any mismatch, revert, stale data,
   allowlist failure, RPC disagreement, or evidence-store failure pauses the
   strategy immediately.

`MEV_LIVE_EXECUTION_ENABLED` must remain `false` until steps 1-6 are complete and
the capped canary is explicitly authorized. Expanding the feature surface comes
after this single end-to-end path is independently verifiable.
