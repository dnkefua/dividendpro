# Geographic MEV worker deployment

This Terraform was applied to `dividendpro-3b397` on 2026-08-01. It declares
three cost-gated, private-ingress native workers in Tokyo
(`asia-northeast1`), Frankfurt (`europe-west3`), and Northern Virginia
(`us-east4`). These match the initial measurement geography identified in
`docs/MEV_RESEARCH.md`.

Each worker:

- has no public IP;
- uses Cloud NAT only for BSC/relay egress;
- pulls an image pinned by digest;
- retrieves one pinned region-specific config version directly from Secret
  Manager through the VM service account without writing it to the host;
- runs read-only, without Linux capabilities, and with no-new-privileges;
- exposes the authenticated native API only on the VPC;
- runs the BSC WebSocket reserve scanner and its local relay adapter while the
  instance is enabled.

## Current deployment state

1. Billing is attached and the required APIs are enabled.
2. The native image is pinned to an Artifact Registry digest.
3. Cloud Run uses Direct VPC egress through `10.64.0.0/26`; both the Google
   Cloud firewall and each COS host restrict worker port `8081` to that range.
4. Each worker reads only its pinned Secret Manager version. The deployed
   versions explicitly set `MEV_LIVE_EXECUTION_ENABLED=false`.
5. A server-to-worker-to-Firestore simulation smoke passed through Firebase
   Hosting with 85% calibrated probability and correctly returned
   `executionReadinessPassed=false` because no finalized canary exists.
6. The three C3 workers are kept `TERMINATED` by the default
   `worker_desired_status` to prevent idle compute charges.

## Before setting workers to `RUNNING`

1. Supply authorized private-relay credentials through pinned regional secret
   versions.
2. Audit and deploy `VerifiedArbitrageExecutor`, then configure its address and
   router/token/recipient allowlists server-side.
3. Add a dedicated signer through Secret Manager and fund only the capped
   canary amount plus gas.
4. Review a fresh Terraform plan with `worker_desired_status="RUNNING"`.
5. Run one USD 25-or-less finalized mainnet canary and preserve the chain
   receipt and `ArbitrageExecuted` event evidence.
