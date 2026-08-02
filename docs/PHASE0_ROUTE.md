# Phase 0 route configuration — USDT/WBNB, PancakeSwap v2 ↔ Biswap

Every address and fee below was resolved on-chain, not assumed. Verified at BSC
block **113532301** against `https://bsc-dataseed1.binance.org/`.

## Verified facts

| | PancakeSwap v2 | Biswap |
|---|---|---|
| Factory | `0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73` | `0x858E3312ed3A876947EA49d572A7C42DE08af7EE` |
| Router | `0x10ED43C718714eb63d5aA57B78B54704E256024E` | `0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8` |
| USDT/WBNB pair | `0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE` | `0x8840C6252e2e86e545deFb6da98B2a0E26d8C1BA` |
| `token0` | USDT | USDT |
| Depth | 18,484,378 USDT / 31,614.82 WBNB | 202,986 USDT / 347.16 WBNB |
| **Swap fee** | **25 bps** | **20 bps** |

Pairs came from `getPair()` on each factory. Each router's `factory()` was confirmed
to match its pair's factory, so the router/pair pairing is not guessed.

**The fees were measured, not assumed.** Each router's `getAmountsOut(1000 USDT)` was
compared against the constant-product formula at the same pinned block, solving for
the fee that reproduces the quote exactly. Biswap is **20 bps** — commonly cited as 10,
which would have made every profit calculation wrong in the optimistic direction.

## What the numbers say about viability

Round-trip fee cost is **45 bps**. At the sampled block the price spread was
**−0.0040%** (0.4 bps, and in the wrong direction).

**The spread must exceed 45 bps before a single unit is gross-profitable**, and that
is before gas. At the moment of sampling the gap was roughly a hundredfold. This is
expected — arbitrages are transient — but it frames what Phase 0 is measuring: not
"is there a spread" but "how often does a spread exceeding 45 bps appear *and survive
one block*."

**Biswap's depth is the binding constraint.** At 203k USDT it is ~90× shallower than
PancakeSwap, so it sets the optimal trade size. `amm::optimal_amount_in` will find
this automatically; the configured ceiling only needs to not be the binding limit.

## Direction

The scanner scans **one direction per configuration**: `pairBuy` is where `tokenIn` is
spent, `pairSell` is where it is recovered. Spreads flip sign, so a single config
catches at most half the opportunities.

**Deploy both configs** as separate strategies:

- `usdt-wbnb-pcs-to-bsw` — buy WBNB on PancakeSwap, sell on Biswap
- `usdt-wbnb-bsw-to-pcs` — the reverse (swap `pairBuy`/`pairSell` and
  `routerBuy`/`routerSell`, and swap `buyFeeBps`/`sellFeeBps` to 20/25)

Their evidence windows are independent, which is useful: it tells you whether one
direction dominates.

## `MEV_SCANNER_CONFIG_JSON`

```json
{
  "enabled": true,
  "controlPlaneUrl": "https://dividendpro-app-539817560279.us-east4.run.app",
  "internalTokenEnv": "MEV_EXECUTOR_INTERNAL_TOKEN",
  "userId": "<FIREBASE_UID>",
  "strategyId": "usdt-wbnb-pcs-to-bsw",
  "websocketRpcUrl": "wss://<LOW_LATENCY_BSC_WS_ENDPOINT>",

  "pairBuy":  "0x16b9a82891338f9bA80E2D6970FddA79D1eb0daE",
  "pairSell": "0x8840C6252e2e86e545deFb6da98B2a0E26d8C1BA",
  "routerBuy":  "0x10ED43C718714eb63d5aA57B78B54704E256024E",
  "routerSell": "0x3a6d8cA21D1CF76F653A67577FA0D27453350dD8",

  "tokenIn":  "0x55d398326f99059fF775485246999027B3197955",
  "tokenOut": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  "tokenInIsToken0Buy":  true,
  "tokenInIsToken0Sell": true,
  "tokenInDecimals": 18,
  "tokenInUsdMicros": 1000000,

  "buyFeeBps":  25,
  "sellFeeBps": 20,

  "amountInBaseUnits":       "2000000000000000000000",
  "minimumProfitBaseUnits":  "1000000000000000000",

  "gasUsdMicros": 400000,
  "relayUsdMicros": 0,
  "slippageUsdMicros": 100000,

  "requireRouterVerification": true,
  "routerQuoteToleranceBps": 30,
  "relayLatencyBudgetMs": 120,
  "startingCapitalUsdMicros": 100000000
}
```

### Field notes

- **`tokenInDecimals: 18`** — BSC USDT is 18 decimals, *not* the 6 used on Ethereum.
  Getting this wrong scales every USD figure by 10¹².
- **`amountInBaseUnits`** is a **ceiling**, not the trade size. 2,000 USDT. The searched
  optimum sizes down from here per block. Against Biswap's 203k depth, 2,000 USDT is
  ~1% of the pool — deliberately conservative.
- **`minimumProfitBaseUnits`** 1 USDT, comfortably above the ~$0.23–0.40 gas estimate
  so marginal trades are filtered before they reach the settlement sample.
- **`gasUsdMicros: 400000`** ($0.40) — conservative. `executeArbitrage` is roughly
  300–400k gas; at 1 gwei and ~$585/BNB that is ~$0.23. Tune from observed receipts.
- **`relayUsdMicros: 0`** — no relay cost in simulation. Set before live.
- **`tokenInUsdMicros: 1000000`** — USDT pegged at $1.00. Fine for a stable input.
- **`requireRouterVerification: true`** — costs 2 RPC round trips per candidate. It is
  the right default for Phase 0 (correctness over speed) and is exactly what Phase 1a
  moves off the hot path.

## Deploy — done

The worker is deployed and healthy. Recorded here because the mechanics are not
obvious and cost two failed attempts to discover.

**The worker does not take its configuration from env vars.** It loads its entire
environment from Secret Manager via `MEV_CONFIG_SECRET_RESOURCE`, which
`bootstrap.rs` requires to be **version-pinned** — `latest` is explicitly rejected.
Per-region secrets already exist: `mev-worker-config-{us-east4,europe-west3,asia-northeast1}`,
each holding `BSC_RPC_URL`, `MEV_RELAYS_JSON`, `MEV_SCANNER_CONFIG_JSON`,
`MEV_SERVICE_TOKEN`, `MEV_LIVE_EXECUTION_ENABLED`, `RUST_LOG`.

**Use the dedicated service account.** `dividendpro-mev-worker@` already holds
`secretAccessor` on those secrets. Deploying under the default compute SA fails with a
403 from Secret Manager and the container exits — correctly, rather than starting
degraded. Do not fix that by granting the default compute SA access; use the intended
identity.

**There is no `gcr.io` Artifact Registry repo in this project**, only
`cloud-run-source-deploy`. `gcloud builds submit --tag gcr.io/...` is denied. Build via
`gcloud run deploy --source .`, which uses the existing repo.

```bash
# Build + deploy in one step, under the intended identity
cd native
gcloud run deploy dividendpro-mev --source . \
  --project dividendpro-3b397 --region us-east4 \
  --no-allow-unauthenticated \
  --service-account dividendpro-mev-worker@dividendpro-3b397.iam.gserviceaccount.com \
  --set-env-vars 'MEV_REGION=us-east4,MEV_CONFIG_SECRET_RESOURCE=projects/dividendpro-3b397/secrets/mev-worker-config-us-east4/versions/1'

# Point the control plane at it (note the ^@^ delimiter — the value contains commas)
gcloud run services update dividendpro-app \
  --project dividendpro-3b397 --region us-east4 \
  --update-env-vars '^@^MEV_ORCHESTRATOR_URLS_JSON=[{"region":"us-east4","url":"https://dividendpro-mev-539817560279.us-east4.run.app"}]'
```

Current state: worker `dividendpro-mev-00002-q9q`, control plane
`dividendpro-app-00011-7nj`, `/api/truth/health` reports `SIMULATION_ONLY`.
Worker logs `scanner is disabled by configuration` — the placeholder route is inert.

## Remaining step to start Phase 0

Add a **new pinned version** of `mev-worker-config-us-east4` whose
`MEV_SCANNER_CONFIG_JSON` is the config above with `enabled: true`, then redeploy the
worker pointing at that version number. Two values must be supplied first:

- `userId` — the Firebase UID the evidence is written under.
- `websocketRpcUrl` — confirm what the secret currently holds. On a public dataseed
  Phase 0 measures the endpoint, not the strategy, and the survival rate will read
  pessimistically. This is the single biggest lever on the result.

`MEV_LIVE_EXECUTION_ENABLED` stays false throughout. Phase 0 needs no capital and no
deployed executor contract.

## What to read after 7 days

From the strategy document's evidence window:

| Field | Question |
|---|---|
| `sampleCount` | Did enough decisions occur to conclude anything? Target ≥ 500. |
| `profitableCount / sampleCount` | **Survival rate.** The go/no-go number. |
| `profitFactorPpm` | Gross win ÷ gross loss. |
| `maxDrawdownBps` | Worst run of losses. |

A survival rate near zero means every race is being lost, and no amount of contract or
audit work changes that. See the kill criteria in `PRODUCTION_PLAN.md`.
