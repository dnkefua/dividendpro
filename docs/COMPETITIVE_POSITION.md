# Competitive Position — an honest assessment

Written in response to: *"you are building to make profit and it's not possible if
it's just a sub-par system."* That is the right standard. This document applies it.

**Short answer: the system is sub-par for the game it is currently pointed at, and
the reason is architectural, not code quality.** Our RPC latency is genuinely good
and almost entirely irrelevant. Details below.

---

## 1. Why the engine only implements constant-product

Not an oversight — a consequence of what each pool type requires.

**UniswapV2 / PancakeSwap v2.** The entire pool state is two numbers. One
`getReserves()` call returns `(reserve0, reserve1)` and price follows in closed form:

```
amount_out = (amount_in · f · reserve_out) / (reserve_in · 10000 + amount_in · f)
```

Two hops compose analytically, which is what makes the closed-form optimal size in
`amm.rs` possible at all.

**Uniswap/PancakeSwap v3.** Liquidity is not uniform. Pricing a swap requires:

- `sqrtPriceX96` and the current tick,
- active liquidity **at that tick**,
- the tick bitmap, because a swap large enough to cross a tick boundary changes the
  active liquidity mid-swap.

Quoting a v3 swap means *simulating tick traversal*. There is no closed form, the
optimal-size search cannot use the `√(A·B)` result, and the state needed per block
is unbounded rather than two integers. It is a different pricing engine, not an
extension of this one. `grep -riE "sqrtprice|tick|concentrated"` over `native/`
returns nothing — no partial implementation exists.

**Why it matters economically.** v3's 1 bps and 5 bps fee tiers are the cheapest
venues on BSC. A v3↔v2 route pays ~26 bps round trip against the 45 bps we pay
today. Since §3 shows the fee floor is the binding constraint, **v3 support is the
single largest economic lever available** — and also the most work.

---

## 2. Latency: ours vs the competition

### What we measure

`data_age_ms` from the deployed worker: **9–34 ms** (p50 ≈ 15 ms) from `newHeads`
arrival to a priced decision, in `us-east4` against Alchemy. Three sequential RPC
round trips ≈ 45 ms, roughly 10% of a 450 ms block. By any ordinary standard that
is fast, and it comfortably clears the "sub-100 ms RPC" bar cited as the
[hard requirement for competitive MEV](https://www.dwellir.com/blog/mev-arbitrage-bot-infrastructure).

### What the competition actually faces

From [MEV in Binance Builder](https://arxiv.org/html/2602.15395) (April 2025 –
February 2026, 9.63M builder-executed arbitrage transactions):

| Finding | Value |
|---|---|
| Profitable opportunity lifetime | **150–400 ms** |
| Returns decay sharply after | **100 ms** |
| Returns below gas cost by | **~200 ms** |
| Builder 30 ms earlier | computes while still profitable |
| Builder 80–120 ms later | "observes a market that has already been arbitraged" |
| Bundle delivery window | **< 200 ms** |
| 48Club + BlockRazor share of blocks | **> 87%** |
| 48Club share of net MEV profit | **~75%** |

### Where that actually puts us

Our 15 ms clock **starts at the wrong moment.** We subscribe to `newHeads`
(`scanner.rs:575`) — a block that is *already mined*. But the opportunity was
created by a swap **inside that block**, and the builder who assembled it saw that
swap first.

```
t = 0 ms        swap enters private orderflow / mempool
t ≈ ?           builder prices it and arbitrages it while building the block
t ≈ 450 ms      block is published
t ≈ 460–485 ms  we receive newHeads and price a decision   ← our 15 ms lives here
t ≈ 495 ms      we could submit, targeting block N+1
```

**We are not 15 ms behind. We are a full block behind — ~450 ms — against a window
where returns fall below gas cost at 200 ms.** We arrive at roughly 2.5× the point
of unprofitability. No amount of RPC tuning closes that; the gap is one block, and
one block is 450 ms.

This is why the `−108 bps` and `−79 bps` readings are not bad luck. By the time we
can see a dislocation, the entity that built the block has already taken it — and
that entity is one of the two builders producing 87% of blocks.

**Verdict: our latency is good and our position is bad.** Those are compatible
statements, and conflating them is how a system looks fine and earns nothing.

---

## 3. What would actually change the position

In increasing order of cost and effect.

### Tier 1 — react before the block, not after *(necessary; not sufficient)*

Replace `eth_subscribe("newHeads")` with pending-transaction flow. Decode a pending
swap, apply its effect to the reserves locally, price the resulting dislocation, and
submit a backrun bundle targeting **the same block**. That is what backrunning
means; we are currently doing something strictly worse.

Removes the ~450 ms structural deficit. Also requires Phase 1a (local reserve state
from `Sync` events) because there is no time for RPC round trips inside that window.

Encouragingly, the literature notes backrunning is
[less competitive than frontrunning](https://www.nadcab.com/blog/mempool-monitoring-mev-bot-technical-implementation-guide)
— it only needs to follow the target, not outbid it.

### Tier 2 — get closer to the order flow

BSC has adopted PBS with **whitelisted builders only**, and meaningful volume moves
as 0-gwei private order flow through builder-operated RPC endpoints, never touching
the public mempool. A searcher watching only the public mempool is blind to it.

Concretely: searcher relationships with 48Club and BlockRazor, and submission
inside their <200 ms bundle window. The relay adapters for both are already
written and schema-correct; they have never been exercised against a live endpoint.

### Tier 3 — stop competing where the incumbents are strongest

The uncomfortable structural fact: **48Club and BlockRazor are simultaneously the
builders and the arbitrageurs.** They see order flow first, arbitrage it during
block construction, and capture ~90% of MEV profit. On liquid majors with two-hop
routes — exactly what this engine does — an external searcher is competing with the
house, using the house's own relay.

What is left for an external participant is what the builders decline: long-tail
pairs outside their monitored set, sizes below their threshold, and dislocations
that persist beyond the 400 ms window because nobody is watching. **That is the
segment worth measuring** — and it is what the pair scan should look for. The
question is not "does a spread exist" but "does a spread *persist*", because
persistence is the observable signature of an opportunity nobody faster wants.

---

## 3a. Empirical confirmation — the pair scan

12 tokens × 3 v2 venues (PancakeSwap 25 bps, Biswap 20 bps, ApeSwap 20 bps), all
paired against WBNB, all existing on all three venues. Every ordered venue pair
priced at a size of 0.05% of the source pool, sampled over 25 consecutive readings.

**72 routes. 1,800 samples. Zero profitable, ever.**

```
route              best   median   #>0
USDC BSW->PCS        -5      -15     0
USDT BSW->PCS       -10      -30     0
LINK BSW->PCS       -15      -17     0
LINK BSW->APE       -22      -22     0
USDT APE->PCS       -24      -34     0
...
CAKE APE->BSW       -43      -43     0
```

The best moment observed on the best route was **5 bps underwater** — before gas.
The median across everything sits −15 to −45 bps, which is approximately the fee
floor. That is the fingerprint of a market arbitraged down to cost by someone
faster: residual divergence is pinned just below what fees allow anyone to take.

Two secondary observations. The tightest routes are stable-quote (USDC, USDT),
where divergence is naturally smallest — being closest to break-even here is a
property of low volatility, not of opportunity. And every leading route ends
`-> PCS`, consistent with PancakeSwap being the deepest venue and therefore the
richer side to sell into.

**This is not a pair-selection problem within v2.** The liquid v2 universe on BSC
is uniformly unprofitable at 40–45 bps round trip. No config change reaches it.

## 4. So: is it sub-par?

**For the current target, yes.** Two-hop atomic arbitrage on BSC majors, reacting to
confirmed blocks, is a market owned by vertically-integrated builders. The
architecture cannot win it, and no amount of polish changes that.

**The engineering underneath is not the problem.** The pricing math is now correct
at production scale, sizing is provably optimal, the risk controls bind on-chain
independent of a compromised control plane, and the evidence layer reports honest
losses. Those are the parts that are expensive to build and easy to get subtly
wrong. They are done.

What is wrong is where it is aimed. That is a cheaper problem than a broken engine,
but it is not a free one, and it will not be fixed by tuning.

**Recommended sequence:**

1. Finish measuring what actually persists (pair scan) — cheap, decides everything.
2. If anything persists past ~400 ms, Tier 1 makes it reachable.
3. If nothing persists, Tier 1 alone will not help; the honest options are v3
   support (better economics) or a different strategy class.

Do not deploy capital until step 1 has an answer.
