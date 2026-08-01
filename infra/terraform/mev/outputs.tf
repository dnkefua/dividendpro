output "worker_private_endpoints" {
  description = "Control-plane MEV_ORCHESTRATOR_URLS_JSON source values."
  value = {
    for region, instance in google_compute_instance.worker :
    region => "http://${instance.network_interface[0].network_ip}:8081"
  }
}

output "billing_gate" {
  value = "Billing was owner-authorized on 2026-08-01. Live execution remains gated by pinned secrets, relay authentication, audited allowlists, signer funding, and a finalized canary receipt."
}
