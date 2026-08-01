use anyhow::{bail, Context};
use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{header, Client};
use serde::Deserialize;
use std::{env, time::Duration};

const METADATA_TOKEN_URL: &str = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";
const SECRET_MANAGER_ROOT: &str = "https://secretmanager.googleapis.com/v1/";

#[derive(Deserialize)]
struct MetadataToken {
    access_token: String,
}

#[derive(Deserialize)]
struct SecretPayload {
    data: String,
}

#[derive(Deserialize)]
struct AccessSecretResponse {
    payload: SecretPayload,
}

fn validate_resource(resource: &str) -> anyhow::Result<()> {
    let parts: Vec<&str> = resource.split('/').collect();
    if parts.len() != 6
        || parts[0] != "projects"
        || parts[2] != "secrets"
        || parts[4] != "versions"
        || parts[1].is_empty()
        || parts[3].is_empty()
        || parts[5].is_empty()
        || parts.iter().any(|part| {
            !part
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.'))
        })
    {
        bail!("MEV_CONFIG_SECRET_RESOURCE must be a pinned Secret Manager version resource");
    }
    if parts[5] == "latest" {
        bail!("MEV_CONFIG_SECRET_RESOURCE must pin a numeric version, not latest");
    }
    parts[5]
        .parse::<u64>()
        .context("MEV_CONFIG_SECRET_RESOURCE version must be numeric")?;
    Ok(())
}

fn parse_env_file(contents: &str) -> anyhow::Result<Vec<(String, String)>> {
    let mut values = Vec::new();
    for (index, raw_line) in contents.lines().enumerate() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, raw_value) = line
            .split_once('=')
            .with_context(|| format!("secret config line {} has no '='", index + 1))?;
        if key.is_empty()
            || !key.chars().enumerate().all(|(position, character)| {
                if position == 0 {
                    character.is_ascii_uppercase() || character == '_'
                } else {
                    character.is_ascii_uppercase()
                        || character.is_ascii_digit()
                        || character == '_'
                }
            })
        {
            bail!("secret config line {} has an invalid environment key", index + 1);
        }
        if matches!(key, "PORT" | "MEV_REGION" | "MEV_CONFIG_SECRET_RESOURCE") {
            bail!("secret config may not override deployment-owned key {key}");
        }
        let value = if raw_value.len() >= 2
            && ((raw_value.starts_with('"') && raw_value.ends_with('"'))
                || (raw_value.starts_with('\'') && raw_value.ends_with('\'')))
        {
            &raw_value[1..raw_value.len() - 1]
        } else {
            raw_value
        };
        values.push((key.to_string(), value.to_string()));
    }
    Ok(values)
}

pub async fn load_secret_environment_if_configured() -> anyhow::Result<()> {
    let Ok(resource) = env::var("MEV_CONFIG_SECRET_RESOURCE") else {
        return Ok(());
    };
    validate_resource(&resource)?;

    let client = Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(10))
        .https_only(false)
        .build()?;
    let token: MetadataToken = client
        .get(METADATA_TOKEN_URL)
        .header("Metadata-Flavor", "Google")
        .send()
        .await
        .context("metadata token request failed")?
        .error_for_status()
        .context("metadata token request was rejected")?
        .json()
        .await
        .context("metadata token response was invalid")?;
    let secret: AccessSecretResponse = client
        .get(format!("{SECRET_MANAGER_ROOT}{resource}:access"))
        .header(header::AUTHORIZATION, format!("Bearer {}", token.access_token))
        .send()
        .await
        .context("Secret Manager request failed")?
        .error_for_status()
        .context("Secret Manager access was rejected")?
        .json()
        .await
        .context("Secret Manager response was invalid")?;
    let decoded = STANDARD
        .decode(secret.payload.data)
        .context("Secret Manager payload was not valid base64")?;
    let contents = String::from_utf8(decoded).context("secret config must be UTF-8")?;
    for (key, value) in parse_env_file(&contents)? {
        env::set_var(key, value);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{parse_env_file, validate_resource};

    #[test]
    fn accepts_pinned_secret_resource() {
        assert!(validate_resource("projects/example/secrets/mev-worker/versions/7").is_ok());
    }

    #[test]
    fn rejects_latest_secret_resource() {
        assert!(validate_resource("projects/example/secrets/mev-worker/versions/latest").is_err());
    }

    #[test]
    fn parses_env_values_without_logging_them() {
        let values = parse_env_file(
            "# deployment config\nMEV_SERVICE_TOKEN=secret\nMEV_RELAYS_JSON='[{\"provider\":\"bloxroute\"}]'\n",
        )
        .unwrap();
        assert_eq!(values[0], ("MEV_SERVICE_TOKEN".into(), "secret".into()));
        assert_eq!(
            values[1],
            (
                "MEV_RELAYS_JSON".into(),
                "[{\"provider\":\"bloxroute\"}]".into()
            )
        );
    }

    #[test]
    fn rejects_deployment_owned_keys() {
        assert!(parse_env_file("MEV_REGION=forged").is_err());
        assert!(parse_env_file("PORT=9000").is_err());
    }
}
