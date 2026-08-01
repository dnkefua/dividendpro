use anyhow::{anyhow, bail, Context, Result};
use reqwest::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone)]
pub struct BscRpcClient {
    http: Client,
    url: String,
    request_id: std::sync::Arc<AtomicU64>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse<T> {
    result: Option<T>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcBlock {
    pub number: String,
    pub hash: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcTransaction {
    pub hash: String,
    pub from: String,
    pub to: Option<String>,
    pub input: String,
    pub block_number: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RpcLog {
    pub address: String,
    pub topics: Vec<String>,
    pub data: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcReceipt {
    pub transaction_hash: String,
    pub status: String,
    pub block_number: String,
    pub block_hash: String,
    pub from: String,
    pub to: Option<String>,
    pub gas_used: String,
    pub effective_gas_price: Option<String>,
    pub logs: Vec<RpcLog>,
}

impl BscRpcClient {
    pub fn new(url: String) -> Result<Self> {
        if !(url.starts_with("https://") || url.starts_with("http://")) {
            bail!("BSC_RPC_URL must be an HTTP(S) URL");
        }
        Ok(Self {
            http: Client::builder()
                .https_only(url.starts_with("https://"))
                .timeout(std::time::Duration::from_secs(5))
                .build()?,
            url,
            request_id: std::sync::Arc::new(AtomicU64::new(1)),
        })
    }

    async fn call<T: DeserializeOwned>(&self, method: &str, params: Value) -> Result<T> {
        let id = self.request_id.fetch_add(1, Ordering::Relaxed);
        let response = self
            .http
            .post(&self.url)
            .json(&json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}))
            .send()
            .await
            .with_context(|| format!("BSC RPC {method} transport failed"))?;
        if !response.status().is_success() {
            bail!("BSC RPC {method} returned HTTP {}", response.status());
        }
        let body: JsonRpcResponse<T> = response.json().await?;
        if let Some(error) = body.error {
            bail!("BSC RPC {method} error {}: {}", error.code, error.message);
        }
        body.result
            .ok_or_else(|| anyhow!("BSC RPC {method} returned no result"))
    }

    async fn call_optional<T: DeserializeOwned>(&self, method: &str, params: Value) -> Result<Option<T>> {
        let id = self.request_id.fetch_add(1, Ordering::Relaxed);
        let response = self
            .http
            .post(&self.url)
            .json(&json!({"jsonrpc":"2.0", "id":id, "method":method, "params":params}))
            .send()
            .await
            .with_context(|| format!("BSC RPC {method} transport failed"))?;
        if !response.status().is_success() {
            bail!("BSC RPC {method} returned HTTP {}", response.status());
        }
        let body: Value = response.json().await?;
        if let Some(error) = body.get("error") {
            bail!("BSC RPC {method} error: {error}");
        }
        let result = body.get("result").cloned().unwrap_or(Value::Null);
        if result.is_null() {
            Ok(None)
        } else {
            Ok(Some(serde_json::from_value(result)?))
        }
    }

    pub async fn chain_id(&self) -> Result<u64> {
        parse_hex_u64(&self.call::<String>("eth_chainId", json!([])).await?)
    }

    pub async fn latest_block(&self) -> Result<RpcBlock> {
        self.call("eth_getBlockByNumber", json!(["latest", false]))
            .await
    }

    pub async fn finalized_block(&self) -> Result<RpcBlock> {
        self.call("eth_getBlockByNumber", json!(["finalized", false]))
            .await
    }

    pub async fn receipt(&self, tx_hash: &str) -> Result<Option<RpcReceipt>> {
        self.call_optional("eth_getTransactionReceipt", json!([tx_hash])).await
    }

    pub async fn transaction(&self, tx_hash: &str) -> Result<Option<RpcTransaction>> {
        self.call_optional("eth_getTransactionByHash", json!([tx_hash])).await
    }

    pub async fn token_balance(
        &self,
        token: &str,
        account: &str,
        block_number: u64,
    ) -> Result<u128> {
        let account = normalize_address(account)?;
        normalize_address(token)?;
        let calldata = format!("0x70a08231{:0>64}", &account[2..]);
        let result: String = self
            .call(
                "eth_call",
                json!([{"to": token, "data": calldata}, format!("0x{block_number:x}")]),
            )
            .await?;
        parse_hex_u128(&result)
    }

    pub async fn call_contract(&self, to: &str, data: &str, block: &str) -> Result<String> {
        normalize_address(to)?;
        if !data.starts_with("0x") || !data[2..].bytes().all(|byte| byte.is_ascii_hexdigit()) {
            bail!("contract calldata is not valid hex");
        }
        self.call("eth_call", json!([{"to": to, "data": data}, block]))
            .await
    }
}

pub fn parse_hex_u64(value: &str) -> Result<u64> {
    u64::from_str_radix(value.trim_start_matches("0x"), 16)
        .with_context(|| format!("invalid u64 hex value {value}"))
}

pub fn parse_hex_u128(value: &str) -> Result<u128> {
    u128::from_str_radix(value.trim_start_matches("0x"), 16)
        .with_context(|| format!("invalid u128 hex value {value}"))
}

pub fn normalize_address(value: &str) -> Result<String> {
    let normalized = value.to_ascii_lowercase();
    if normalized.len() != 42
        || !normalized.starts_with("0x")
        || !normalized[2..].bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        bail!("invalid EVM address");
    }
    Ok(normalized)
}
