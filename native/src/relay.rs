use crate::model::RelayAcknowledgement;
use anyhow::{bail, Context, Result};
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Instant;

/// Private-orderflow providers this worker can submit bundles through.
///
/// Adding a provider is deliberately explicit rather than string-driven: an
/// unrecognised provider name must fail at construction, not silently post a
/// bloXroute-shaped body to an endpoint that expects something else.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RelayProvider {
    Bloxroute,
    /// 48 Club "Puissant" — BSC-native private bundle relay.
    FortyEightClub,
    /// BlockRazor — BSC private relay / builder.
    BlockRazor,
}

impl RelayProvider {
    fn parse(value: &str) -> Result<Self> {
        match value {
            "bloxroute" => Ok(Self::Bloxroute),
            "48club" => Ok(Self::FortyEightClub),
            "blockrazor" => Ok(Self::BlockRazor),
            other => bail!("unsupported private relay provider: {other}"),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Bloxroute => "bloxroute",
            Self::FortyEightClub => "48club",
            Self::BlockRazor => "blockrazor",
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayConfig {
    pub provider: String,
    pub region: String,
    pub url: String,
    pub authorization_env: String,
    /// Header carrying the relay credential. Defaults to `Authorization`,
    /// which is what all three currently supported providers expect.
    #[serde(default = "default_authorization_header")]
    pub authorization_header: String,
}

fn default_authorization_header() -> String {
    "Authorization".to_string()
}

#[derive(Clone)]
pub struct PrivateRelay {
    config: RelayConfig,
    provider: RelayProvider,
    authorization: String,
    client: Client,
}

impl PrivateRelay {
    pub fn from_config(config: RelayConfig) -> Result<Self> {
        let provider = RelayProvider::parse(&config.provider)?;
        if !config.url.starts_with("https://") {
            bail!("private relay URL must use HTTPS");
        }
        let authorization = std::env::var(&config.authorization_env)
            .with_context(|| format!("missing relay secret {}", config.authorization_env))?;
        Ok(Self {
            config,
            provider,
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
        let body = Self::bundle_body(self.provider, raw_transactions, target_block, execution_id);
        let result = self
            .client
            .post(&self.config.url)
            .header(self.config.authorization_header.as_str(), &self.authorization)
            .json(&body)
            .send()
            .await;
        let latency_ms = started.elapsed().as_millis() as u64;
        match result {
            Ok(response) if response.status().is_success() => {
                let value: Result<Value, _> = response.json().await;
                match value {
                    Ok(body) if body.get("error").is_none() => RelayAcknowledgement {
                        provider: self.provider.as_str().to_string(),
                        region: self.config.region.clone(),
                        accepted: true,
                        latency_ms,
                        reference: body.get("result").map(Value::to_string),
                        error: None,
                    },
                    Ok(body) => RelayAcknowledgement {
                        provider: self.provider.as_str().to_string(),
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

    /// Build the provider-specific bundle submission body.
    ///
    /// The three providers are NOT interchangeable, and the differences are the
    /// silent kind — a wrong field name or number encoding is accepted by the
    /// transport and simply never included, which is indistinguishable from
    /// losing the auction. Each body below is transcribed from the vendor's
    /// current documented example:
    ///
    /// | Provider   | Method               | Block field    | Block type | txs prefix |
    /// |------------|----------------------|----------------|------------|------------|
    /// | bloXroute  | `blxr_submit_bundle` | `block_number` | hex string | unprefixed |
    /// | 48 Club    | `eth_sendBundle`     | `maxBlockNumber` | decimal  | `0x`       |
    /// | BlockRazor | `eth_sendMevBundle`  | `maxBlockNumber` | decimal  | `0x`       |
    ///
    /// Note that BlockRazor uses `eth_sendMevBundle`, not `eth_sendBundle`, and
    /// that both non-bloXroute providers take the block height as a JSON number
    /// rather than a hex string.
    ///
    /// Sources:
    /// - <https://docs.48.club/puissant-builder/send-bundle>
    /// - <https://docs.blockrazor.io/scutum-eth-and-bsc/api>
    /// Associated rather than a method so it can be unit-tested without a
    /// configured relay, which would require a live credential in the process
    /// environment.
    fn bundle_body(
        provider: RelayProvider,
        raw_transactions: &[String],
        target_block: u64,
        execution_id: &str,
    ) -> Value {
        // Empty `revertingTxHashes` means "revert on any failure" — the bundle
        // lands atomically or not at all. Never populate it with our own
        // hashes: an arbitrage leg permitted to revert pays gas for nothing.
        match provider {
            RelayProvider::Bloxroute => {
                let transactions: Vec<String> = raw_transactions
                    .iter()
                    .map(|tx| tx.trim_start_matches("0x").to_string())
                    .collect();
                json!({
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
                })
            }
            RelayProvider::FortyEightClub => {
                json!({
                    "jsonrpc": "2.0",
                    "id": execution_id,
                    "method": "eth_sendBundle",
                    "params": [{
                        "txs": prefixed(raw_transactions),
                        "maxBlockNumber": target_block,
                        "revertingTxHashes": []
                    }]
                })
            }
            RelayProvider::BlockRazor => {
                json!({
                    "jsonrpc": "2.0",
                    "id": execution_id,
                    "method": "eth_sendMevBundle",
                    "params": [{
                        "txs": prefixed(raw_transactions),
                        "revertingTxHashes": [],
                        "maxBlockNumber": target_block
                    }]
                })
            }
        }
    }

    fn failure(&self, latency_ms: u64, error: String) -> RelayAcknowledgement {
        RelayAcknowledgement {
            provider: self.provider.as_str().to_string(),
            region: self.config.region.clone(),
            accepted: false,
            latency_ms,
            reference: None,
            error: Some(error),
        }
    }
}

/// Normalise raw transactions to the `0x`-prefixed form both Flashbots-style
/// providers expect. bloXroute is the odd one out and wants them unprefixed.
fn prefixed(raw: &[String]) -> Vec<String> {
    raw.iter()
        .map(|tx| {
            if tx.starts_with("0x") {
                tx.clone()
            } else {
                format!("0x{tx}")
            }
        })
        .collect()
}

pub fn load_relays() -> Result<Vec<PrivateRelay>> {
    let raw = std::env::var("MEV_RELAYS_JSON").unwrap_or_else(|_| "[]".to_string());
    let configs: Vec<RelayConfig> = serde_json::from_str(&raw).context("invalid MEV_RELAYS_JSON")?;
    configs.into_iter().map(PrivateRelay::from_config).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_providers_parse() {
        assert_eq!(
            RelayProvider::parse("bloxroute").unwrap(),
            RelayProvider::Bloxroute
        );
        assert_eq!(
            RelayProvider::parse("48club").unwrap(),
            RelayProvider::FortyEightClub
        );
        assert_eq!(
            RelayProvider::parse("blockrazor").unwrap(),
            RelayProvider::BlockRazor
        );
    }

    /// An unrecognised provider must fail at construction. Falling back to a
    /// default body shape would post a bloXroute payload to an endpoint that
    /// does not understand it — which fails silently as "bundle not included"
    /// rather than as an error anyone would notice.
    #[test]
    fn unknown_provider_is_rejected() {
        assert!(RelayProvider::parse("flashbots").is_err());
        assert!(RelayProvider::parse("").is_err());
    }

    #[test]
    fn provider_names_round_trip() {
        for name in ["bloxroute", "48club", "blockrazor"] {
            assert_eq!(RelayProvider::parse(name).unwrap().as_str(), name);
        }
    }

    fn body(provider: RelayProvider) -> Value {
        PrivateRelay::bundle_body(
            provider,
            &["0xdeadbeef".to_string()],
            39_177_941,
            "execution-1",
        )
    }

    #[test]
    fn bloxroute_body_keeps_its_proven_shape() {
        let body = body(RelayProvider::Bloxroute);
        assert_eq!(body["method"], "blxr_submit_bundle");
        // bloXroute takes an object, a hex block height, and unprefixed txs.
        assert_eq!(body["params"]["block_number"], "0x255ced5"); // 39_177_941
        assert_eq!(body["params"]["transaction"][0], "deadbeef");
        assert_eq!(body["params"]["blockchain_network"], "BSC-Mainnet");
        assert_eq!(body["params"]["enable_backrunme"], false);
    }

    /// 48 Club takes `maxBlockNumber` as a JSON *number*. Sending a hex string
    /// here is accepted by the transport and then silently never included.
    #[test]
    fn forty_eight_club_uses_decimal_max_block_number() {
        let body = body(RelayProvider::FortyEightClub);
        assert_eq!(body["method"], "eth_sendBundle");
        assert_eq!(body["params"][0]["maxBlockNumber"], 39_177_941_u64);
        assert!(body["params"][0]["maxBlockNumber"].is_number());
        assert_eq!(body["params"][0]["txs"][0], "0xdeadbeef");
    }

    /// BlockRazor's BSC method is `eth_sendMevBundle`, NOT `eth_sendBundle`.
    #[test]
    fn blockrazor_uses_send_mev_bundle() {
        let body = body(RelayProvider::BlockRazor);
        assert_eq!(body["method"], "eth_sendMevBundle");
        assert_ne!(body["method"], "eth_sendBundle");
        assert_eq!(body["params"][0]["maxBlockNumber"], 39_177_941_u64);
        assert!(body["params"][0]["maxBlockNumber"].is_number());
        assert_eq!(body["params"][0]["txs"][0], "0xdeadbeef");
    }

    /// An arbitrage leg allowed to revert pays gas for nothing. Every provider
    /// must be told the bundle is all-or-nothing.
    #[test]
    fn no_provider_permits_reverting_transactions() {
        for provider in [RelayProvider::FortyEightClub, RelayProvider::BlockRazor] {
            let body = body(provider);
            assert_eq!(
                body["params"][0]["revertingTxHashes"].as_array().unwrap().len(),
                0
            );
        }
    }

    #[test]
    fn transaction_prefixing_is_idempotent() {
        assert_eq!(prefixed(&["0xabc".to_string()]), vec!["0xabc".to_string()]);
        assert_eq!(prefixed(&["abc".to_string()]), vec!["0xabc".to_string()]);
    }

    #[test]
    fn plaintext_relay_urls_are_refused() {
        let config = RelayConfig {
            provider: "bloxroute".to_string(),
            region: "eu".to_string(),
            url: "http://relay.invalid".to_string(),
            authorization_env: "UNSET_RELAY_SECRET_FOR_TEST".to_string(),
            authorization_header: default_authorization_header(),
        };
        assert!(PrivateRelay::from_config(config).is_err());
    }
}
