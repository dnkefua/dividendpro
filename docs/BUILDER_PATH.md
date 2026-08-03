# Stopping playing searcher — what the builder side actually requires

Researched in response to: *how can we be part of 48Club and BlockRazor so we're
on a fair playing field?*

**Headline: builder participation on BSC is officially permissionless. The barrier
is not permission — it is order flow, and that is a distribution problem, not an
engineering one.**

---

## 1. What the protocol actually says

From [BNB Chain's validator MEV FAQ](https://docs.bnbchain.org/bnb-smart-chain/validator/mev/faqs/):

> "BNB Chain is a permission-less ecosystem, anyone who implements the standard
> builder API could be the BNB Chain builder."

Supporting facts:

- **BEP-322** defines a standard builder API so validators can accept builder
  registration [permissionlessly](https://www.bnbchain.org/en/blog/advancing-bnb-chains-mev-landscape-embracing-proposer-builder-separation-pbs-of-bsc).
- The builder client is **open source**: [`bnb-chain/bsc-builder`](https://github.com/bnb-chain/bsc-builder),
  a go-ethereum fork.
- Validators can integrate **multiple builders simultaneously**.
- No stake, bond, or deposit is specified anywhere in the public documentation.
- Payment flows natively: validators receive `gasFee · commissionRate − builderFee`,
  and "searchers pay builders through higher gas fees natively, rather than
  monthly subscriptions."

So the door is legally open. Nothing stops us registering a builder.

## 2. Why two builders still hold 87% of blocks

[MEV in Binance Builder](https://arxiv.org/html/2602.15395) measures 48Club and
BlockRazor at >87% of blocks and ~90% of MEV profit. If registration is
permissionless, that concentration needs explaining. It is a **two-sided cold
start**:

```
order flow  →  more valuable blocks  →  higher bids  →  validators route to you
     ↑                                                            │
     └──────────  searchers send you their flow  ←────────────────┘
```

A builder with no order flow assembles blocks from the public mempool only. Its
bid is lower than a builder holding exclusive private flow, so it loses every
auction, so no searcher sends it flow. **Registering as a builder without order
flow means winning approximately zero blocks.**

This also explains the paper's finding that builders are themselves the largest
arbitrageurs — 9.63M builder-executed arbitrage transactions. Order flow arrives,
they arbitrage it during construction, and they capture the value before any
external searcher can bid for it. Being the builder *is* the edge.

## 3. The four real paths

| Path | What it is | Capital | Engineering | Honest odds |
|---|---|---|---|---|
| **A. Run a builder** | Register via BEP-322, run `bsc-builder` | Co-located infra, ~$500–2k/mo | Months | Near-zero block wins without flow. Cold start is the wall |
| **B. Originate order flow** | Route user transactions; builders pay for it. 48 Club advertises "builder-direct routing with extra backrun cashback paid back to senders" | Low | Low–moderate | **Real, but requires users** |
| **C. Validator / delegation** | Stake BNB, receive a share of MEV paid up by builders | High (BNB) | None | Passive yield, not an edge |
| **D. Searcher, builder-direct** | Submit bundles into 48Club / BlockRazor searcher endpoints | Low | Already built | Where we are. Competing with the house |

### Path A in detail

Technically open, and worth understanding precisely because it is tempting.

A builder's advantage is not speed — it is **guaranteed inclusion of its own
bundles in blocks it wins**. No relay race, no bidding against others for
position. But that advantage only applies to blocks you actually win, and you win
blocks by submitting the highest bid, and your bid reflects the value of the order
flow you hold.

With public-mempool flow only, our block is worth roughly what everyone else's is,
minus the exclusive flow the incumbents hold. We would lose essentially every
auction.

### Path B is the one that actually changes the game

48 Club pays **backrun cashback to order-flow senders**. That is the builder side
paying for exactly the thing that gates Path A. It inverts the relationship: rather
than competing to extract MEV, you are paid a share of it for supplying the raw
material.

The catch is unambiguous: **this needs transaction volume you originate.** A
wallet, a DEX front end, an RPC endpoint, a trading tool — something with users
whose transactions you can route. That is a product and distribution problem. It
is not adjacent to anything built so far.

## 4. Honest recommendation

Becoming a builder is not blocked by permission, capital, or code. It is blocked
by the same thing that makes the searcher path unwinnable: **we have no order
flow, and order flow is what everything else is downstream of.**

Ranked by expected value for this operation:

1. **Do not run a builder yet.** It is permissionless and buildable, and it would
   win nothing. The cold start is real and there is no way to bootstrap through it
   with engineering.
2. **If any product here can originate transactions, that is the highest-value
   asset in this whole project.** DividendPro is a trading interface. If it ever
   routes real user trades, that flow is directly monetisable through 48 Club's
   cashback programme — with no latency race and no competition for inclusion.
3. **Keep the searcher path alive only as a measurement**, to learn whether any
   under-served niche exists. That is what the persistence survey is for.
4. **Treat validator delegation as an investment decision**, not a strategy.

The uncomfortable summary: the profitable side of BSC MEV is not "who computes
fastest" but "who owns the flow". Every engineering improvement we make optimises
a position downstream of that. The one asset that would change the position is
users, and no amount of Rust produces those.
