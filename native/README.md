# DividendPro native MEV worker

This directory contains the real Rust orchestrator and C++ hot-path risk kernel.
It has no browser code, fabricated relay status, or synthetic execution result.

## Local build

```sh
cargo test
cargo run
```

or, without a host Rust/C++ toolchain:

```sh
docker build -t dividendpro-mev ./native
```

The process refuses to start without a server-to-server `MEV_SERVICE_TOKEN` of
at least 32 characters. Live execution additionally requires all of:

- `MEV_LIVE_EXECUTION_ENABLED=true`
- `BSC_RPC_URL` pointing to chain 56 with `finalized` tag support
- `MEV_RELAYS_JSON` containing one or more HTTPS private relay definitions
- each relay's authorization secret in the named environment variable
- a request authorized by the 85% promotion evidence and the C++ risk kernel

Example relay configuration (the actual authorization value remains in its own
secret environment variable):

```json
[
  {
    "provider": "bloxroute",
    "region": "europe-west3",
    "url": "https://mev.api.blxrbdn.com",
    "authorizationEnv": "BLOXROUTE_AUTHORIZATION"
  }
]
```

Live submission accepts signed transaction bytes; it does not accept a private
key. Signing is a separate server-side responsibility so the same bytes can be
sent from every region without nonce races.

## APIs

- `GET /health` — minimal unauthenticated liveness
- `GET /v1/status` — authenticated deployment truth
- `POST /v1/replay` — time-ordered historical/current simulation metrics
- `POST /v1/evaluate` — C++ current-opportunity evaluation
- `POST /v1/promotion/evaluate` — statistical state transition
- `POST /v1/executions` — private fan-out and finalized reconciliation

All `/v1` calls require `x-mev-service-token`. Only the Node control plane has
that token; browser clients never call the worker directly.

When `MEV_SCANNER_CONFIG_JSON.enabled` and deployment live policy are both true,
the worker subscribes to BSC `newHeads`, reads the two configured V2 pair
reserves at that block, and sends unique positive-after-cost observations to
`/api/mev/internal/observe`. The server recomputes the replay window and
promotion automatically. Only an authorized canary/live response causes the
same opportunity to continue to `/api/mev/internal/execute`.
