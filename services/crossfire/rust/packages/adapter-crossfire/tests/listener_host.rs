use crossfire_adapter_crossfire::listener_host::{Host, Options};
use crossfire_adapter_filesystem::local_state::State;
use crossfire_agent_core::{
    listener::{ControlEndpoint, Reply},
    local_state::LocalState,
};
use serde_json::{Value, json};
use std::{os::unix::fs::PermissionsExt, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

struct Endpoint;
impl ControlEndpoint for Endpoint {
    fn session(&self) -> &str {
        "saved-native-session"
    }
    fn read(&self, input: Value, _stop: CancellationToken) -> Reply<'_> {
        Box::pin(async move { Ok(json!({"text":input,"queryId":null})) })
    }
    fn acknowledge(&self, _query: String, _stop: CancellationToken) -> Reply<'_> {
        Box::pin(async { Ok(json!({"accepted":true})) })
    }
    fn test(&self, _stop: CancellationToken) -> Reply<'_> {
        Box::pin(async { Ok(json!({"authenticated":true})) })
    }
}
fn options(name: &str, stop: CancellationToken) -> Options {
    Options {
        name: name.to_owned(),
        cursor: format!("{name}/receive.json"),
        release: "0.1.20-000000000000000000000000".to_owned(),
        stop,
    }
}
#[tokio::test]
async fn one_actual_private_http_host_dispatches_isolated_bindings_and_rejects_origins_invalid_controls_and_stale_secrets()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
    let storage = Arc::new(State::open(directory.path(), true)?);
    let host = Host::open(storage.clone()).await?;
    let stop = CancellationToken::new();
    let binding = host.bind(options("analyst", stop.clone()))?;
    assert!(
        host.bind(options("analyst", CancellationToken::new()))
            .is_err()
    );
    assert!(host.close().await.is_err());
    let metadata: Value = serde_json::from_slice(
        &storage
            .read("analyst/listener.json", 65536)?
            .ok_or("metadata required")?,
    )?;
    let url = format!(
        "http://127.0.0.1:{}/bindings/analyst/control",
        metadata["port"]
    );
    let secret = metadata["secret"].as_str().ok_or("secret required")?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()?;
    let denied = client
        .post(&url)
        .json(&json!({"action":"status"}))
        .send()
        .await?;
    assert_eq!(denied.status().as_u16(), 403);
    assert!(denied.bytes().await?.is_empty());
    let denied = client
        .post(&url)
        .bearer_auth(secret)
        .header("origin", "http://localhost")
        .json(&json!({"action":"status"}))
        .send()
        .await?;
    assert_eq!(denied.status().as_u16(), 403);
    let status: Value = client
        .post(&url)
        .bearer_auth(secret)
        .json(&json!({"action":"status"}))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(status["ready"], false);
    let reader = client
        .post(&url)
        .bearer_auth(secret)
        .json(&json!({"action":"read","input":{}}))
        .send()
        .await?;
    assert_eq!(reader.status().as_u16(), 409);
    assert_eq!(
        reader.json::<Value>().await?["error"]["code"],
        "unavailable"
    );
    binding.ready().send_replace(Some(Arc::new(Endpoint)));
    let status: Value = client
        .post(&url)
        .bearer_auth(secret)
        .json(&json!({"action":"status"}))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(status["ready"], true);
    assert_eq!(status["session"], "saved-native-session");
    let read: Value = client
        .post(&url)
        .bearer_auth(secret)
        .json(&json!({"action":"read","input":{"kind":"history"}}))
        .send()
        .await?
        .json()
        .await?;
    assert_eq!(read["ok"], true);
    assert_eq!(read["value"]["text"]["kind"], "history");
    let malformed = client
        .post(&url)
        .bearer_auth(secret)
        .json(&json!({"action":"stop","extra":true}))
        .send()
        .await?;
    assert_eq!(malformed.status().as_u16(), 400);
    assert!(!stop.is_cancelled());
    let stopping = client
        .post(&url)
        .bearer_auth(secret)
        .json(&json!({"action":"stop"}))
        .send()
        .await?;
    assert_eq!(stopping.status().as_u16(), 200);
    assert!(stop.is_cancelled());
    binding.close()?;
    assert!(storage.read("analyst/listener.json", 65536)?.is_none());
    let replacement = host.bind(options("analyst", CancellationToken::new()))?;
    let stale = client
        .post(&url)
        .bearer_auth(secret)
        .json(&json!({"action":"status"}))
        .send()
        .await?;
    assert_eq!(stale.status().as_u16(), 403);
    replacement.close()?;
    host.close().await?;
    host.close().await?;
    assert!(
        host.bind(options("later", CancellationToken::new()))
            .is_err()
    );
    Ok(())
}
