# Truth Layer v1

## Release objective

Provide one verifiable end-to-end financial execution path while preventing any simulation, fallback, UI timer, or locally generated identifier from being represented as live profit or confirmed settlement.

## Implemented receipt-verification path (funded smoke pending)

1. User signs in through Firebase Authentication.
2. User enters the amount and destination and acknowledges that this moves real funds.
3. The browser enforces BSC Mainnet chain ID `56`.
4. The connected wallet signs `transfer(to, value)` on canonical BSC USDT contract `0x55d398326f99059fF775485246999027B3197955`.
5. The client waits for a status-1 transaction receipt.
6. After the receipt, the wallet signs a gas-free EIP-191 evidence statement containing the Firebase UID and exact settlement fields.
7. The authenticated backend verifies that wallet proof and independently retrieves the receipt and transaction from BSC RPC.
8. The backend verifies chain, sender, token contract, recipient, amount, exact `Transfer` event, and that the receipt block is at or below BSC's reported finalized block.
9. Firebase Admin writes evidence to `users/{uid}/settlements/{txHash}`.
10. Only after the evidence write succeeds does the UI show `VERIFIED_ON_CHAIN`.
11. Telegram sends a server-side verified notification with the immutable BscScan link.

If the transaction succeeds but evidence persistence fails, the UI says exactly that and preserves the transaction hash. It never reports an unverified success.

## Simulation boundary

- Quant Alpha `mainnet` calls throw until a real order/fill adapter exists.
- Quant paper records use `SIM-*` identifiers.
- Arbitrage and Maestro loops are paper-only model scanners.
- Hummingbot reports offline when `/health` is unavailable and does not invent bots or profit.
- The MEV browser has no submission method. The native worker reports offline until authenticated regional workers are configured.
- Rust/C++ replay, opportunity scoring, automatic 85% promotion, private bundle fan-out, atomic execution, and finalized event reconciliation are implemented under `native/`, `server/mev*.ts`, and `contracts/VerifiedArbitrageExecutor.sol`.
- Live MEV remains execution-disabled after billing and infrastructure
  provisioning until private relay credentials, a funded signer, an
  audited/deployed executor with allowlists, and the capped canary smoke test
  are available.
- Sniper execution and generic PancakeSwap execution are disabled until router-specific receipt and token-delta reconciliation exists.
- The browser does not accept API keys or private keys. A warning and deliberate cleanup control are shown if legacy encrypted sniper-wallet data remains in browser storage.

## Server-only configuration

Required production environment variables:

- `FIREBASE_PROJECT_ID=dividendpro-3b397`
- `BSC_RPC_URL=<production BSC RPC endpoint>`
- `GEMINI_API_KEY=<Secret Manager reference>`
- `TELEGRAM_BOT_TOKEN=<Secret Manager reference>`
- `TELEGRAM_CHAT_ID=<Secret Manager reference>`
- `MEV_SERVICE_TOKEN=<Secret Manager reference>`
- `MEV_EXECUTOR_INTERNAL_TOKEN=<Secret Manager reference>`
- `MEV_KMS_KEY_VERSION=<non-secret Cloud KMS key-version resource name>`
- `MEV_EXECUTION_SIGNER_ADDRESS=<KMS-derived public BSC address>`
- `MEV_ORCHESTRATOR_URLS_JSON=<private regional worker endpoints>`

Never use `VITE_` for server secrets. Vite is explicitly restricted to public Firebase metadata and the base path.
The execution private key is HSM-backed and non-exportable. Cloud Run has only
`roles/cloudkms.signerVerifier` on the specific production signing key.

## Executor on-chain controls

`VerifiedArbitrageExecutor` enforces its own limits rather than trusting the
control plane that builds the call. The server-side `MEV_ROUTER_ALLOWLIST`,
`MEV_PROFIT_RECIPIENT_ALLOWLIST`, and `MEV_MAX_LIVE_NOTIONAL_USD_MICROS` remain,
but they are now the outer of two independent checks.

- Routers and profit recipients must be proposed on chain and become usable only
  after `ALLOWLIST_DELAY` (24 hours, a compile-time constant). Revocation is
  immediate.
- Both exits for value — arbitrage profit and `recoverToken` — require an active
  allowlisted recipient. The signing key is HSM-backed and non-exportable, so the
  threat is key *use* by anything reaching the signing path; the 24-hour delay is
  what bounds that exposure, and it applies to every exfiltration route.
- `maxAmountIn` is a per-input-token ceiling. An unset ceiling denies the token,
  so a newly listed token cannot trade until a limit is set deliberately.

**Deployment consequence:** the canary profit recipient and both routers must be
proposed at least 24 hours before the first live execution. Plan the canary
window around this; it cannot be shortened.

## Security rules

- Users can read/write only their own transactions and settings.
- Users can read only their own settlement evidence.
- Settlement evidence cannot be written by clients; Firebase Admin writes it after verification.
- All other Firestore access is denied.

## Acceptance checks

- `npm run lint` passes.
- `npm test` passes transfer-event, wallet-ownership, fail-closed simulation,
  KMS low-s normalisation, and executor value-exit constraint tests.
- `cd native && cargo test` passes (no local toolchain; build through
  `rust:1.89-bookworm` in Docker, matching `native/Dockerfile`).
- `npm run test:contracts` (`forge test`) passes. The suite executes the
  executor rather than grepping it: allowlist timelock boundaries, both
  value-exit paths, the profit floor under fuzzed rates, reentrancy, and
  non-standard ERC20 behaviour. Without a local Foundry install:

  ```
  docker run --rm -v "$(pwd -W):/w" -w /w --entrypoint sh \
    ghcr.io/foundry-rs/foundry:latest \
    -c 'git config --global --add safe.directory /w; forge test'
  ```

  `lib/forge-std` is a pinned submodule — run `git submodule update --init`
  on a fresh clone.
- `contracts/VerifiedArbitrageExecutor.sol` compiles under solc 0.8.24.
- `npm run build` succeeds.
- Client bundle contains no Telegram bot token pattern.
- `/api/truth/health` reports `truth-layer-v1`, chain `56`, and the real
  `SIMULATION_ONLY`/`LIVE_CAPABLE` state. Settlement verification is explicitly
  identified as verification, not execution.
- Production `/api/settlements/verify` rejects missing authentication, invalid wallet proof, wrong token, wrong sender, wrong recipient, wrong amount, pending transaction, and reverted receipt.
- A successful production transfer creates a user-scoped evidence record and links to the same transaction on BscScan.

## Deployment

The backend is deployed as Cloud Run service `dividendpro-app` in `us-east4`.
Firebase Hosting routes `/api/**` to that service and serves `dist/client` for
all frontend routes. The default Firestore Native database is also in
`us-east4`, and the per-user rules in `firestore.rules` are deployed.

Billing and the required APIs are enabled. The geographically distributed C3
workers are provisioned but stopped after the successful simulation smoke. A
mainnet claim remains blocked until relay credentials, an audited and deployed
executor, server-side allowlists, a funded signer, and a finalized capped
canary receipt exist.
