# Strategy Specification — BSC Two-Venue Constant-Product Arbitrage

All figures below are measured, not assumed. Sources are named so every number
can be re-derived.

---

## 1. The strategy in one paragraph

Watch two constant-product (UniswapV2-style) pools holding the same token pair on
different BSC venues. When their implied prices diverge by more than the combined
round-trip cost, buy the cheap side and sell the expensive side **atomically in a
single transaction**, so the position never exists between legs. Size the trade to
the profit-maximising amount for that block's reserves. Submit through a private
relay so the bundle is not visible in the public mempool.

The executor reverts unless it clears a minimum profit, so the failure mode is a
spent gas fee, never a held position and never a partial fill.

---

## 2. The governing inequality

Everything reduces to one comparison:

```
price divergence between venues   >   buy fee + sell fee + gas + slippage
```

**Measured at block 113733535:**

| | |
|---|---|
| PancakeSwap v2 price | 583.4627 USDT/WBNB |
| Biswap price | 582.5949 USDT/WBNB |
| **Divergence** | **≈ 15 bps** |
| PancakeSwap fee | 25 bps *(solved against `getAmountsOut`)* |
| Biswap fee | 20 bps *(same method — commonly misquoted as 10)* |
| **Round-trip fee floor** | **45 bps** |
| Round trip, PCS→BSW, 1000 USDT | **−108 bps** |
| Round trip, BSW→PCS, 1000 USDT | **−79 bps** |

**The divergence is one third of the fee floor.** Neither direction is tradeable.
This is not a market that happens to be quiet — WBNB/USDT between two major BSC
venues is continuously arbitraged by faster participants, and the residual
divergence sits structurally below what a 45 bps round trip can capture.

The asymmetry between −108 and −79 is price impact: 1000 USDT is ~0.5% of
Biswap's pool, so the shallow side contributes slippage on top of divergence.

**Conclusion: this pair is not a viable strategy at these fee tiers.** Selecting a
different pair is the highest-leverage change available — larger than any latency
or infrastructure work.

---

## 3. Pair selection criteria

A candidate pair must satisfy, in priority order:

1. **Combined fee < expected divergence.** This is binding and non-negotiable.
   Every other property is secondary.
2. **Both venues run constant-product v2 maths.** The engine implements
   `x·y=k` only. PancakeSwap **v3 is concentrated liquidity and is NOT supported**
   — its 1 bps and 5 bps tiers are the most attractive fee levels on BSC and are
   out of reach without a separate pricing implementation.
3. **Adequate depth on the shallower side.** The shallow pool caps size. Optimal
   sizing handles this automatically, but a pool too thin to clear gas is useless.
4. **Divergence that actually recurs.** Volatile pairs diverge more because venues
   re-price at different speeds. Majors are efficient; that is precisely why the
   pair above fails.

### Where to look next

| Direction | Rationale | Cost |
|---|---|---|
| Lower-fee v2 venues | THENA, ApeSwap and similar run below 25 bps. Two 20 bps venues is a 40 bps floor — still high | config only |
| Volatile / mid-cap pairs | Divergence scales with volatility and with how thinly each venue is arbitraged | config only |
| **PancakeSwap v3 support** | 1–5 bps tiers would cut the floor from 45 bps to ~26 bps or below. **The single largest available improvement** | new pricing engine |

The honest ranking: v3 support changes the economics by more than everything else
on this list combined, and it is also the most work.

---

## 4. Execution architecture

```
newHeads (Alchemy wss)
   ↓  measured 9–34 ms
read both pairs at the pinned block
   ↓
size: closed-form optimum, exact-integer ternary search   (amm.rs)
   ↓
router cross-check at the same block                       (2 RPC round trips)
   ↓
C++ risk kernel: 8 gates                                   (mev_kernel.cpp)
   ↓
control plane: server-owned probability, KMS signature
   ↓
private relay bundle (bloXroute / 48 Club / BlockRazor)
   ↓
settle at block N+1 → realized outcome, may be negative    (evidence)
```

**Sizing.** Composing two hops gives `out(x) = A·x / (B + C·x)`, so the optimum is
closed-form: `x* = (√(A·B) − B) / C`, profitable iff `A > B`. The closed form runs
in f64 as a seed and fast-reject; the size actually chosen comes from an
exact-integer ternary search, so float error can cost basis points of yield but can
never make an unprofitable route look profitable.

**Arithmetic.** Products are carried at 256 bits. `amount_with_fee · reserve_out`
needs 45 decimal digits for a real pair against a 39-digit `u128`. Computing it in
`u128` returns zero on overflow, which reports every route as unprofitable — a
failure indistinguishable from a quiet market. This was a live bug; see §7.

---

## 5. Risk controls

**On-chain** (`VerifiedArbitrageExecutor.sol`) — these bind even if the control
plane is fully compromised:

- Atomic or nothing: reverts unless `inputAfter ≥ inputBefore + minProfit`.
- Profit recipients and routers require a **24-hour timelock** before use;
  revocation is immediate. Ownership transfer carries the same delay and can be
  cancelled.
- Per-token `maxAmountIn`; an unset ceiling denies the token outright.
- `executionId` is single-use, so settlement cannot be misattributed.
- Every value exit terminates at an allowlisted recipient. The signing key is
  HSM-backed and non-exportable (`0xF69bf03d…E4df`, derived from Cloud KMS and
  verified to match the configured address) — **no private key exists for anyone
  to hold or lose.**

**Off-chain** — the C++ kernel rejects on: simulation failure, stale data,
public route, insufficient liquidity, sub-threshold probability, non-positive net,
excess latency, excess notional.

---

## 6. Promotion — evidence, not intuition

`SIMULATION → CANARY_LIVE → LIVE`, server-authoritative:

| Gate | Threshold |
|---|---|
| Wilson lower bound (95%, one-sided) | ≥ 85% |
| Calibrated probability | ≥ 85% |
| Sample count | ≥ 200 |
| Brier loss | ≤ 10% |
| Expected calibration error | ≤ 5% |
| Profit factor | ≥ 1.25 |
| Max drawdown | ≤ 500 bps |
| Finalized canary executions (for LIVE) | ≥ 20, with **zero** evidence failures |

Observed win rate is deliberately not sufficient: 170/200 is exactly 85% and still
fails, because the Wilson lower bound at that sample size is ~80.4%. Demotion floors
sit below promotion floors; the gap is a hysteresis band that stops a strategy
oscillating on sampling noise.

**Evidence is measured at settlement, not at decision.** A decision taken at block N
is re-priced against block N+1 and reported with its realized outcome, which is
frequently negative. Reporting at decision time made every sample profitable by
construction — the gates were measuring the profit filter rather than the strategy.

---

## 7. What the first hour of live measurement found

The heartbeat exists because an observation is only written when a spread clears
the fee floor, so silence is ambiguous. Within three minutes of deployment it found:

1. **Latency is fine.** `data_age_ms` 9–34 ms from `us-east4`, ~10% of a 450 ms
   block. The prior 155 ms public-dataseed figure would have consumed 103%.
2. **`shortfall_bps = 10000` on every block** — the round trip returned exactly
   zero. Not a market condition; the u128 overflow described in §4. The scanner
   could never have found an opportunity, and a seven-day run would have produced
   an empty evidence window with no error.
3. **After the fix, `shortfall_bps` ≈ 108–114** — a real measurement, matching the
   independent calculation in §2.

The lesson worth keeping: unit tests used reserves of `1e6` where nothing overflows.
Any AMM test not run at production magnitudes (`1e22`–`1e25`) is testing the wrong
thing.

---

## 8. Kill criteria

Stop rather than escalate if any hold:

- Survival rate < 5% after 500 settled samples across two pairs.
- p50 decision latency cannot be held under 50 ms. *(Currently 9–34 ms — passing.)*
- Canary net-negative after gas across 20 finalized executions.
- Any unexplained gap between simulated and realized profit.

---

## 9. Current status

| | |
|---|---|
| Latency | ✅ 9–34 ms measured |
| Pricing arithmetic | ✅ fixed, tested at production scale |
| Evidence honesty | ✅ settled outcomes, losses representable |
| Executor contract | ❌ **never deployed** — `0xaCb2bDfA…30aa` has no bytecode |
| Execution signer | ✅ KMS `0xF69bf03d…E4df` (the separately supplied `0x001bb8f4…` is unrelated and unused) |
| Profit recipient | ✅ `0x9bf7bEd9…9802`, correctly separate from the personal wallet |
| **Viable pair** | ❌ **the blocker** — divergence 15 bps vs 45 bps floor |

Live execution is disabled and no capital is at risk. The next decision is pair
selection, not infrastructure.
