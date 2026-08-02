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

## Deploy sequence

```bash
# 1. Worker image (runs cargo test during build)
cd native
gcloud builds submit --tag gcr.io/dividendpro-3b397/dividendpro-mev --project dividendpro-3b397

# 2. Worker service — no public ingress, live execution OFF
gcloud run deploy dividendpro-mev \
  --image gcr.io/dividendpro-3b397/dividendpro-mev \
  --project dividendpro-3b397 --region us-east4 \
  --no-allow-unauthenticated \
  --set-env-vars 'MEV_REGION=us-east4,BSC_RPC_URL=<HTTPS_RPC>,MEV_LIVE_EXECUTION_ENABLED=false' \
  --set-secrets 'MEV_SERVICE_TOKEN=mev-service-token:latest,MEV_EXECUTOR_INTERNAL_TOKEN=mev-executor-internal-token:latest'

# 3. Point the control plane at it
gcloud run services update dividendpro-app \
  --project dividendpro-3b397 --region us-east4 \
  --set-env-vars 'MEV_ORCHESTRATOR_URLS_JSON=[{"region":"us-east4","url":"<WORKER_URL>"}]'

# 4. Confirm
curl -s https://dividendpro-3b397.web.app/api/truth/health   # expect SIMULATION_ONLY
```

`MEV_LIVE_EXECUTION_ENABLED` stays false. Phase 0 is measurement only; no capital and
no deployed executor contract are required.

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
