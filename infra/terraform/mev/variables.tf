variable "project_id" {
  description = "GCP project. Billing must be authorized before apply."
  type        = string
}

variable "worker_image" {
  description = "Immutable Artifact Registry image digest for dividendpro-mev."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.worker_image))
    error_message = "worker_image must be pinned by sha256 digest."
  }
}

variable "machine_type" {
  description = "Native worker machine type. Benchmark before changing."
  type        = string
  default     = "c3-standard-4"
}

variable "worker_desired_status" {
  description = "Cost-control gate. Keep TERMINATED until live credentials, allowlists, funding, and an authorized canary are ready."
  type        = string
  default     = "TERMINATED"

  validation {
    condition     = contains(["RUNNING", "TERMINATED"], var.worker_desired_status)
    error_message = "worker_desired_status must be RUNNING or TERMINATED."
  }
}

variable "worker_config_secret_names" {
  description = "Existing Secret Manager env-file secret name for each region. Values are not managed by Terraform."
  type        = map(string)
  default = {
    "asia-northeast1" = "mev-worker-config-asia-northeast1"
    "europe-west3"    = "mev-worker-config-europe-west3"
    "us-east4"        = "mev-worker-config-us-east4"
  }
}

variable "worker_config_secret_versions" {
  description = "Pinned Secret Manager version for each regional worker config. Never use latest."
  type        = map(string)
  default = {
    "asia-northeast1" = "1"
    "europe-west3"    = "1"
    "us-east4"        = "1"
  }

  validation {
    condition = alltrue([
      for version in values(var.worker_config_secret_versions) : can(regex("^[1-9][0-9]*$", version))
    ])
    error_message = "Every worker config secret version must be a positive numeric version."
  }
}
