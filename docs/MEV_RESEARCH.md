# BSC MEV and low-latency execution research

Research date: 2026-08-01

## What the chain can actually guarantee

BNB Smart Chain mainnet has used a 0.45 second target block interval since the
Fermi upgrade. With Fast Finality votes operating normally, the chain documents
finality within two blocks, approximately 1.125 seconds. If those votes are not
available, BSC falls back to probabilistic finality. The execution system must
therefore measure inclusion and finality; it must never advertise a fixed
"instant" finality guarantee.

The authoritative completion check is the JSON-RPC `finalized` block tag. A
transaction is not a realized trade merely because a relay accepted it or it
appeared in a non-final block.

Primary sources:

- [BSC architecture and current finality](https://docs.bnbchain.org/bnb-smart-chain/introduction/)
- [Fermi upgrade and 0.45 second blocks](https://docs.bnbchain.org/announce/fermi-bsc/)
- [BSC finality JSON-RPC APIs](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/bsc-api-list/)
- [BSC benchmark design targets](https://docs.bnbchain.org/bnb-smart-chain/benchmark/design-reference/)

## BSC MEV topology

BSC uses proposer-builder separation described by BEP-322. Builders construct
candidate blocks and submit bids through validator MEV sentries. Searcher bundle
interfaces are provider-specific; the BSC builder protocol is not a reason to
assume an Ethereum relay endpoint or method is compatible.

The first supported strategies are non-user-harming atomic arbitrage and
consensual backruns. Sandwiching and harmful public-mempool front-running are
out of scope. The engine rejects unprotected public submission for these
strategies.

Primary sources:

- [BEP-322 builder specification](https://github.com/bnb-chain/BEPs/blob/master/BEPs/BEP322.md)
- [BNB Chain builder integration](https://docs.bnbchain.org/bnb-smart-chain/validator/mev/builder-integration/)
- [BNB Chain MEV user guide](https://docs.bnbchain.org/bnb-smart-chain/validator/mev/user-guide/)
- [BNB Chain client](https://github.com/bnb-chain/bsc)

## Data and relay transports

The transport abstraction supports a local BSC WebSocket node plus private
provider adapters. bloXroute documents filtered `newTxs`/`pendingTxs` streams,
local-node validation, BSC bundle tracing, and a private token-launch backrun
workflow. BlockRazor documents `eth_sendMevBundle` forwarding and regional raw
transaction relays. Provider latency and inclusion figures are vendor claims,
not system guarantees; production selection will be made from our own p50, p90,
and p99 measurements.

The same signed transaction or deterministic bundle is fanned out to configured
private relays. Workers do not generate competing transactions with the same
account nonce. A submission is successful only when chain reconciliation—not a
provider response—proves it.

Sources:

- [bloXroute BSC stream local validation](https://docs.bloxroute.com/bsc/streams/newtxs-and-pendingtxs/local-node-validation)
- [bloXroute stream filters](https://docs.bloxroute.com/bsc-and-eth/streams/newtxs-and-pendingtxs/filter)
- [bloXroute bundle trace](https://docs.bloxroute.com/bsc/submit-bundles/bsc-bundle-trace)
- [bloXroute token-launch backruns](https://docs.bloxroute.com/bsc-and-eth/apis/token-launch-sniping)
- [bloXroute algorithmic-trading guidance](https://docs.bloxroute.com/resources/guides/algorithmic-trading)
- [BlockRazor searcher integration](https://blockrazor.gitbook.io/blockrazor/use-cases/searcher)
- [BlockRazor regional BSC raw-transaction relay](https://blockrazor.gitbook.io/blockrazor/transaction-submission/fast/bsc/send-rawtxbatch)

## Geographic placement

The hot path is an always-on native worker, not a cold-started request handler.
The initial three observation/submission regions are:

| Region | GCP region | Relay locality represented |
| --- | --- | --- |
| Asia | `asia-northeast1` (Tokyo) | BlockRazor Tokyo and APAC BSC peers |
| Europe | `europe-west3` (Frankfurt) | BlockRazor Frankfurt and European BDN peers |
| North America | `us-east4` (Northern Virginia) | BlockRazor Virginia and North American peers |

The regions are initial measurement sites, not a claim that a particular
validator is always located there. Each region records node-to-worker and
worker-to-relay latency. Placement changes require measured improvement.

Google documents that selecting a region close to the point of service reduces
latency, and lists the available Compute Engine regions. The deployment uses
always-on Compute Engine workers; Cloud Run remains appropriate for the control
plane but is not the latency-critical scanner.

- [Google Cloud regions and zones](https://docs.cloud.google.com/compute/docs/regions-zones)
- [Viewing current Compute Engine regions](https://docs.cloud.google.com/compute/docs/regions-zones/viewing-regions-zones)

## The 85% promotion threshold

A classifier score is not automatically a trustworthy probability. The model's
output is calibrated on data disjoint from training data and evaluated with a
reliability curve, Brier loss, and expected calibration error. Trading samples
are time-ordered and walk-forward; random shuffling would leak future market
regimes into the past.

Promotion requires both:

1. the current opportunity has calibrated `P(net profit > 0) >= 0.85`; and
2. the one-sided 95% Wilson lower confidence bound of profitable, out-of-sample
   simulations is at least 0.85.

This intentionally demands stronger evidence than an observed 85% win rate.
NIST recommends Wilson-style proportion intervals and documents the one-sided
construction. Model calibration guidance explains that a well-calibrated 0.8
prediction should occur with the positive class about 80% of the time.

- [NIST binomial confidence intervals](https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm)
- [Probability calibration](https://scikit-learn.org/stable/modules/calibration.html)

## Findings that affect the implementation

- Finality is observed, not hard-coded.
- Relay acceptance, bundle simulation, inclusion, and finality are separate
  evidence states.
- Native workers never hold browser-provided keys. Live keys are injected only
  into the server-side signer from a managed secret at deployment time.
- One account/nonce owner creates a signed transaction. Regional workers fan out
  identical bytes, preventing double execution caused by geographic races.
- An atomic executor must revert when post-trade balance is below the configured
  minimum. Off-chain estimated profit is never recorded as realized profit.
- Token-launch opportunities require trap/honeypot and sell-path simulation.
- No paid provider claim is treated as verified until the production smoke test
  captures our own measurements.
- Repeated blocks with an identical reserve-state commitment do not count as
  independent simulation observations. The server ledger deduplicates the
  simulation state hash before replay metrics are recomputed.
