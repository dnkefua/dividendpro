# Production Plan — BSC Arbitrage Executor

Status at time of writing: control plane and hosting deployed (`dividendpro-app-00010-6bw`),
`SIMULATION_ONLY`, live execution disabled, executor contract not deployed, native
workers not deployed. Nothing in production can currently trade.

---

## 0. Read this before committing money

Two structural facts should shape every decision below.

**The critical path is 3 sequential RPC round trips.** After a `newHeads` frame the
scanner does `getReserves` on both pairs (1 round trip, parallelised), then
`getAmountsOut` on the buy router, then `getAmountsOut` on the sell router — and the
second router quote depends on the first, so it cannot be parallelised. On a hosted
BSC RPC at 20–80ms per call that is **60–240ms of decision latency** against **0.45s
blocks** (post-Fermi). Competitive searchers price from locally maintained reserve
state with zero round trips and submit in single-digit milliseconds.

Note that the router cross-check added during hardening is responsible for 2 of those
3 round trips. It buys real safety and it costs real latency. Phase 1 moves it off the
hot path rather than removing it.

**Two-pool constant-product arbitrage on PancakeSwap is the most contested niche in
BSC MEV.** It is the first strategy every entrant builds, it requires no proprietary
signal, and the winner is decided almost entirely by latency and builder relationships.
A correct implementation is necessary but nowhere near sufficient.

The honest expectation is that this strategy, on hosted RPC, wins close to zero
contested opportunities. **That is a testable claim and Phase 0 tests it for roughly
the cost of a coffee**, before any audit spend. Do not skip it.

---

## Phase 0 — Falsify the thesis cheaply

**Objective:** find out whether *any* opportunity survives to the settlement block
before spending money on an audit.

This is possible now, and only now, because the evidence loop reports realized
outcomes including losses. Prior to that change every sample was profitable by
construction and this phase would have told you nothing.

### Tasks

1. **Build and deploy the native worker.**
   ```
   cd native
   gcloud builds submit --tag gcr.io/dividendpro-3b397/dividendpro-mev --project dividendpro-3b397
   gcloud run deploy dividendpro-mev --image gcr.io/dividendpro-3b397/dividendpro-mev \
     --project dividendpro-3b397 --region us-east4 --no-allow-unauthenticated
   ```
   Set `MEV_ORCHESTRATOR_URLS_JSON` on `dividendpro-app` to point at it.
   Leave `MEV_LIVE_EXECUTION_ENABLED` unset.

2. **Configure one route** via `MEV_SCANNER_CONFIG_JSON`. Start with the deepest,
   most-traded pair you can find on two venues — WBNB/USDT across PancakeSwap v2 and
   Biswap. Deep pools mean the optimal size is large enough that gas is not the
   dominant term.

3. **Run for 7 days.** Do nothing else. The scanner will evaluate every block, take
   decisions, and settle each one against the following block.

### Exit criteria — the go/no-go gate

Read the evidence window off the strategy document:

| Metric | Meaning | Go threshold |
|---|---|---|
| `sampleCount` | decisions taken | ≥ 500 |
| `profitableCount / sampleCount` | **survival rate** | **≥ 15%** |
| `profitFactorPpm` | gross win ÷ gross loss | ≥ 1_250_000 |
| Wilson lower bound | 95% one-sided floor on survival | ≥ 850_000 *(will fail at 15% — see below)* |

**The survival rate is the number that matters.** It is the fraction of decisions
that were still profitable one block later. If it is near zero, you are losing every
race and no amount of contract work changes that.

Note the tension deliberately: the promotion policy demands a Wilson lower bound of
85%, which a 15% survival rate cannot satisfy. That is correct and intentional. A 15%
survival rate means *the strategy as configured is not promotable* — it means the
thesis is alive but the latency work in Phase 1 is mandatory, not optional. A survival
rate above 85% would be extraordinary and should be treated as a bug until proven.

**Stop criteria:** survival rate < 5% after 500 samples across two different pairs.
At that point the strategy is not viable on this infrastructure, and the correct
decision is to change the strategy or the infrastructure — not to proceed to audit.

**Cost:** two Cloud Run services, hosted RPC. Tens of dollars.

---

## Phase 1 — Close the latency and correctness gaps

Only start this if Phase 0 cleared the stop criteria.

### 1a. Remove the RPC round trips from the hot path

The single highest-leverage change in this document.

- **Maintain reserve state locally.** Subscribe to `Sync(uint112,uint112)` events on
  both pairs and keep reserves in memory. Pricing then costs zero round trips. Fall
  back to `getReserves` only on reconnect or gap detection.
- **Move router verification off the decision path.** Keep it — it catches router-fee
  mismatches and wrong pairings — but run it once per pair per N blocks as a
  *configuration validity* check, not once per opportunity. Cache the result.
- **Measure the result.** `data_age_ms` is now instrumented and honest; the target is
  a p50 under 20ms from head arrival to decision.

### 1b. Correctness items deferred during hardening

| Item | Why it matters | Effort |
|---|---|---|
| Buy-leg `amountOutMin` | Currently `1`. Capital is safe via the atomic check, but a front-runner can take everything above `minProfit`. Requires adding a field to `ArbitrageParams` — **do this before the audit**, not after. | S |
| Dynamic `minProfit` | Currently a static config constant unrelated to the block's actual opportunity. Should be derived from the sized trade and live gas price. | M |
| Fee-on-transfer detection | `getAmountsOut` is a view over reserves and cannot see transfer-time behaviour. Needs REVM or a simulated swap. Correct the overstated doc comment in `scanner.rs` either way. | L |
| Server-side USD notional | `notionalUsdMicros` is scanner-declared and not bound to the signed `amountIn`. Mitigated on-chain by `maxAmountIn`; the server-side caps remain advisory until a server price source exists. | M |
| Relay secret rotation | Read once at construction; rotation requires a restart. | S |

### 1c. Prove the relays

The 48 Club and BlockRazor bundle bodies are transcribed from vendor docs and have
**never been sent to a live endpoint**. Submit a deliberately invalid bundle to each
and confirm a *structured rejection* comes back. Silence is the failure mode — it is
indistinguishable from losing the auction. Also confirm the signer's gas pricing
clears BlockRazor's 0.1 gwei average floor.

### Exit criteria
- p50 decision latency < 20ms.
- Survival rate re-measured over 500 fresh samples and materially improved.
- Structured rejection received from every configured relay.

---

## Phase 2 — Contract audit and deployment

Do not start until Phase 1b is complete. Auditing, then changing the ABI, then
re-auditing is the expensive order.

1. **Write fork tests.** The 33 Foundry tests use mocks. Add tests that fork BSC
   mainnet and run against the real PancakeSwap router and real USDT — including a
   real fee-on-transfer token, which the mocks do not cover.
2. **Engage an auditor.** ~260 lines, well-commented, with a passing test suite.
   Budget low five figures upward; scope and firm reputation vary widely.
3. **Deploy.** Then, in order:
   - `setMaxAmountIn(tokenIn, cap)` — start small, e.g. 100 USDT equivalent.
   - `proposeRouter(pancake)`, `proposeRouter(biswap)`, `proposeRecipient(treasury)`.
   - **Wait 24 hours.** `ALLOWLIST_DELAY` is a compile-time constant and cannot be
     shortened. Plan the canary window around this.
4. Set `MEV_EXECUTOR_ADDRESS` and the three server-side allowlists.

### Exit criteria
- Audit findings resolved or accepted in writing.
- Contract deployed, verified on BscScan, allowlists matured.
- `/api/truth/health` reports `mevExecutorConfigured: true`.

---

## Phase 3 — Canary

1. Fund the executor with **the minimum viable working capital** — a few hundred
   dollars of `tokenIn`, plus BNB for gas on the signer. The contract's balance is the
   blast radius of a control-plane compromise; keep it small and top up per-session
   rather than parking capital.
2. Set `MEV_LIVE_EXECUTION_ENABLED=true` on both the worker and the control plane.
   The strategy will sit at `SIMULATION` until the promotion gates pass.
3. Let promotion happen on its own. `SIMULATION → CANARY_LIVE` needs 200 samples at
   Wilson ≥85%; `CANARY_LIVE → LIVE` needs 20 finalized canary executions with zero
   evidence failures.

### Watch for
- **Any** `canaryEvidenceFailures` increment pauses the strategy and is terminal until
  investigated. Treat it as a stop-the-line event, not noise.
- Simulation will read optimistically against live results — it models the race but
  not gas-price competition or bundle inclusion probability. Expect a gap and treat
  its *size* as information.
- Reverted bundles cost gas and nothing else. A high revert rate is a latency signal.

### Exit criteria
- 20 finalized canary executions, zero evidence failures, net positive after gas.

---

## Phase 4 — Scale or stop

Raise `maxAmountIn` in steps, re-measuring profit factor at each step. Larger size
moves the pool more, so realized profit does not scale linearly with capital — the
closed-form optimum in `amm.rs` already accounts for this, which is why sizing must
stay dynamic rather than reverting to a fixed notional.

Add a second and third route only after the first is stable. Add relay providers for
redundancy, not for speed.

---

## Parallel hygiene (does not block)

| Item | Action |
|---|---|
| `master` branch | Still holds the fabricated version. Tag it `archive/fabricated-ui` and delete, or force it to `codex/truth-layer-release`. It must not be deployable by accident. |
| `gcloud` default project | Currently `binancep2p-bot`. `gcloud config set project dividendpro-3b397`. Only the explicit `--project` flag kept the last deploy on target. |
| `The production KMS signer.txt` | Move out of the OneDrive-synced repo directory. Excluded from git and Cloud Build, but it should not live there. |
| Dead placeholder address | `0x71c765E12a832109841b9200428190345718976f` holds 261 USDT and has never sent a transaction. Recoverable only if a private key exists. |
| Address poisoning | Lookalike `0x71C7…976f` addresses are seeding your wallet history. Never copy a destination from history; verify all 42 characters. |

---

## Capital required

| Purpose | Amount |
|---|---|
| Executor working capital (canary) | a few hundred USD in `tokenIn` |
| Signer gas float | 0.1–0.5 BNB, topped up |
| Audit | low five figures upward |
| Infrastructure | tens of USD/month (2 Cloud Run services + RPC) |
| Co-located RPC (if Phase 1a is insufficient) | materially more — dedicated node or paid low-latency provider |

---

## Kill criteria

Stop and reconsider rather than escalating if any of these hold:

- Survival rate < 5% after 500 samples across two pairs (Phase 0).
- p50 decision latency cannot be brought under 50ms without dedicated infrastructure.
- Canary net-negative after gas across 20 finalized executions.
- Any unexplained discrepancy between simulated and realized profit.

The purpose of the evidence layer is to make stopping a decision you can take on data
rather than on feel. It only works if you honour it when the data is unwelcome.
