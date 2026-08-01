locals {
  workers = {
    "asia-northeast1" = {
      zone = "asia-northeast1-b"
      cidr = "10.61.0.0/24"
    }
    "europe-west3" = {
      zone = "europe-west3-a"
      cidr = "10.62.0.0/24"
    }
    "us-east4" = {
      zone = "us-east4-a"
      cidr = "10.63.0.0/24"
    }
  }
}

resource "google_compute_network" "mev" {
  name                    = "dividendpro-mev"
  auto_create_subnetworks = false
  routing_mode            = "GLOBAL"
}

resource "google_compute_subnetwork" "mev" {
  for_each                 = local.workers
  name                     = "dividendpro-mev-${each.key}"
  region                   = each.key
  network                  = google_compute_network.mev.id
  ip_cidr_range            = each.value.cidr
  private_ip_google_access = true
}

resource "google_compute_subnetwork" "control_plane" {
  name                     = "dividendpro-mev-control-plane"
  region                   = "us-east4"
  network                  = google_compute_network.mev.id
  ip_cidr_range            = "10.64.0.0/26"
  private_ip_google_access = true
}

resource "google_compute_router" "mev" {
  for_each = local.workers
  name     = "dividendpro-mev-${each.key}"
  region   = each.key
  network  = google_compute_network.mev.id
}

resource "google_compute_router_nat" "mev" {
  for_each                           = local.workers
  name                               = "dividendpro-mev-${each.key}"
  router                             = google_compute_router.mev[each.key].name
  region                             = each.key
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "LIST_OF_SUBNETWORKS"
  min_ports_per_vm                   = 128

  subnetwork {
    name                    = google_compute_subnetwork.mev[each.key].id
    source_ip_ranges_to_nat = ["ALL_IP_RANGES"]
  }
}

resource "google_service_account" "worker" {
  account_id   = "dividendpro-mev-worker"
  display_name = "DividendPro native MEV worker"
}

resource "google_project_iam_member" "worker_roles" {
  for_each = toset([
    "roles/artifactregistry.reader",
    "roles/logging.logWriter",
    "roles/monitoring.metricWriter",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_config_access" {
  for_each  = var.worker_config_secret_names
  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_compute_firewall" "control_plane" {
  name      = "dividendpro-mev-control-plane"
  network   = google_compute_network.mev.name
  direction = "INGRESS"
  priority  = 1000

  source_ranges = [google_compute_subnetwork.control_plane.ip_cidr_range]
  target_tags   = ["dividendpro-mev-worker"]

  allow {
    protocol = "tcp"
    ports    = ["8081"]
  }
}

resource "google_compute_firewall" "iap_ssh" {
  name      = "dividendpro-mev-iap-ssh"
  network   = google_compute_network.mev.name
  direction = "INGRESS"
  priority  = 1000

  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["dividendpro-mev-worker"]

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }
}

resource "google_compute_instance" "worker" {
  for_each       = local.workers
  name           = "dividendpro-mev-${each.key}"
  zone           = each.value.zone
  machine_type   = var.machine_type
  desired_status = var.worker_desired_status
  tags           = ["dividendpro-mev-worker"]

  boot_disk {
    auto_delete = true
    initialize_params {
      image = "projects/cos-cloud/global/images/family/cos-stable"
      size  = 20
      type  = "pd-balanced"
    }
  }

  network_interface {
    subnetwork = google_compute_subnetwork.mev[each.key].id
    # No access_config: workers have no public ingress address.
  }

  service_account {
    email  = google_service_account.worker.email
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  metadata = {
    enable-oslogin = "TRUE"
    startup-script = <<-SCRIPT
      #!/bin/bash
      set -euo pipefail
      REGION='${each.key}'
      SECRET_RESOURCE='projects/${var.project_id}/secrets/${var.worker_config_secret_names[each.key]}/versions/${var.worker_config_secret_versions[each.key]}'
      CONTROL_PLANE_CIDR='${google_compute_subnetwork.control_plane.ip_cidr_range}'
      export DOCKER_CONFIG='/var/lib/dividendpro-docker'
      install -d -m 0700 "$DOCKER_CONFIG"
      iptables -C INPUT -p tcp -s "$CONTROL_PLANE_CIDR" --dport 8081 -j ACCEPT 2>/dev/null || \
        iptables -A INPUT -p tcp -s "$CONTROL_PLANE_CIDR" --dport 8081 -j ACCEPT
      docker-credential-gcr configure-docker --registries="$(echo '${var.worker_image}' | cut -d/ -f1)"
      docker pull '${var.worker_image}'
      docker rm -f dividendpro-mev 2>/dev/null || true
      docker run --detach --name dividendpro-mev --restart=always --network=host \
        -e MEV_CONFIG_SECRET_RESOURCE="$SECRET_RESOURCE" \
        -e MEV_REGION="$REGION" -e PORT=8081 \
        --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
        --security-opt=no-new-privileges --cap-drop=ALL \
        '${var.worker_image}'
    SCRIPT
  }

  depends_on = [
    google_compute_router_nat.mev,
    google_project_iam_member.worker_roles,
  ]
}
