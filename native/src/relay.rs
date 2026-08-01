use crate::model::RelayAcknowledgement;
use anyhow::{bail, Context, Result};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Instant;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayConfig {
    pub provider: String,
    pub region: String,
    pub url: String,
    pub authorization_env: String,
}

#[derive(Clone)]
pub struct PrivateRelay {
    config: RelayConfig,
    authorization: String,
    client: Client,
}

impl PrivateRelay {
    pub fn from_config(config: RelayConfig) -> Result<Self> {
        if config.provider != "bloxroute" {
            bail!("unsupported private relay provider: {}", config.provider);
        }
        if !config.url.starts_with("https://") {
            bail!("private relay URL must use HTTPS");
        }
        let authorization = std::env::var(&config.authorization_env)
            .with_context(|| format!("missing relay secret {}", config.authorization_env))?;
        Ok(Self {
            config,
            authorization,
            client: Client::builder()
                .https_only(true)
                .timeout(std::time::Duration::from_secs(3))
                .build()?,
        })
    }

    pub async fn submit_bundle(
        &self,
        raw_transactions: &[String],
        target_block: u64,
        execution_id: &str,
    ) -> RelayAcknowledgement {
        let started = Instant::now();
        let transactions: Vec<String> = raw_transactions
            .iter()
            .map(|tx| tx.trim_start_matches("0x").to_string())
            .collect();
        let body = json!({
            "jsonrpc": "2.0",
            "id": execution_id,
            "method": "blxr_submit_bundle",
            "params": {
                "transaction": transactions,
                "block_number": format!("0x{target_block:x}"),
                "blockchain_network": "BSC-Mainnet",
                "uuid": execution_id,
                "enable_backrunme": false,
                "blocks_count": 3
            }
        });
        let result = self
            .client
            .post(&self.config.url)
            .header("Authorization", &self.authorization)
            .json(&body)
            .send()
            .await;
        let latency_ms = started.elapsed().as_millis() as u64;
        match result {
            Ok(response) if response.status().is_success() => {
                let value: Result<Value, _> = response.json().await;
                match value {
                    Ok(body) if body.get("error").is_none() => RelayAcknowledgement {
                        provider: self.config.provider.clone(),
                        region: self.config.region.clone(),
                        accepted: true,
                        latency_ms,
                        reference: body.get("result").map(Value::to_string),
                        error: None,
                    },
                    Ok(body) => RelayAcknowledgement {
                        provider: self.config.provider.clone(),
                        region: self.config.region.clone(),
                        accepted: false,
                        latency_ms,
                        reference: None,
                        error: Some(
                            body.get("error")
                                .map(Value::to_string)
                                .unwrap_or_else(|| "relay response had no result".to_string()),
                        ),
                    },
                    Err(error) => self.failure(latency_ms, format!("invalid relay JSON: {error}")),
                }
            }
            Ok(response) => self.failure(latency_ms, format!("HTTP {}", response.status())),
            Err(error) => self.failure(latency_ms, error.to_string()),
        }
    }

    fn failure(&self, latency_ms: u64, error: String) -> RelayAcknowledgement {
        RelayAcknowledgement {
            provider: self.config.provider.clone(),
            region: self.config.region.clone(),
            accepted: false,
            latency_ms,
            reference: None,
            error: Some(error),
        }
    }
}

pub fn load_relays() -> Result<Vec<PrivateRelay>> {
    let raw = std::env::var("MEV_RELAYS_JSON").unwrap_or_else(|_| "[]".to_string());
    let configs: Vec<RelayConfig> = serde_json::from_str(&raw).context("invalid MEV_RELAYS_JSON")?;
    configs.into_iter().map(PrivateRelay::from_config).collect()
}
