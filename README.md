# DividendPro / Lumina Finance

DividendPro is an AI-assisted dividend research, portfolio, and Web3 execution workspace. The application deliberately separates model simulations from live financial execution.

## Truth-layer contract

- Paper Quant, arbitrage, Maestro, MEV, and unavailable Hummingbot flows are labelled simulation or offline.
- Simulation identifiers never use blockchain transaction-hash formatting.
- Generic PancakeSwap and sniper execution are disabled until their receipts and token deltas can be reconciled server-side.
- The implemented settlement-verification path covers a non-custodial BSC USDT
  transfer signed in the user's wallet; it is not claimed production-verified
  until a funded receipt smoke is completed.
- Settlement success requires a wallet ownership proof, a status-1 receipt, an exact canonical USDT `Transfer(from,to,value)` event, and inclusion at or below BSC's reported finalized block.
- The backend verifies Firebase identity and writes immutable evidence to `users/{uid}/settlements/{txHash}`.
- Gemini and Telegram credentials and dispatch stay server-side; Vite exposes only public Firebase metadata. Verified settlement alerts link to BscScan evidence.
- Firestore data is scoped to the authenticated user; clients cannot write settlement evidence.
- A real native MEV path lives in `native/`: Rust WebSocket scanning/orchestration plus a C++ fixed-point risk kernel.
- The 85% rule is a calibrated probability and one-sided Wilson lower-bound gate over at least 200 time-ordered samples.
- Automatic promotion is `SIMULATION -> CANARY_LIVE -> LIVE`; canary is capped at USD 25 and requires 20 finalized successes with zero evidence failures before scaling.
- The only coded live MEV call is the allowlisted atomic V2 executor in `contracts/VerifiedArbitrageExecutor.sol`; it reverts below minimum profit.
- The BSC execution signer is an HSM-backed, non-exportable Google Cloud KMS
  secp256k1 key. The server pins its derived public address and validates KMS
  request/response CRC32C checks before accepting a signature.
- Geographic worker Terraform for Tokyo, Frankfurt, and Northern Virginia has
  been applied under `infra/terraform/mev`. The workers are provisioned but
  default to `TERMINATED` after the simulation smoke until live credentials,
  allowlists, executor deployment, signer funding, and canary authorization are
  present.

See [TRUTH_LAYER.md](TRUTH_LAYER.md) for acceptance criteria and deployment requirements.
See [the MEV autonomy specification](docs/MEV_AUTONOMY_SPEC.md) and [research record](docs/MEV_RESEARCH.md) for the native promotion and deployment design.

## Local development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run lint
npm test
npm run build
```

The production server is `dist/server.cjs`; static Firebase Hosting assets are emitted to `dist/client`.
