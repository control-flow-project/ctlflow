use crossfire_adapter_matrix::{
    agent::Client,
    protocol::{Protocol, Request, Response},
};
mod support;
use crossfire_agent_core::{
    coordination::Coordination,
    local_state::LocalState,
    profile,
    reset_history::{self, Options},
};
use crossfire_contracts::{call::Call, operations::OperationId};
use crossfire_domain::runtime::values::HistoryMode;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use tokio_util::sync::CancellationToken;
const ID: &str = "00000000-0000-4000-8000-000000000000";
struct Network {
    allowed: AtomicBool,
    fail: AtomicBool,
    pages: AtomicUsize,
}
impl Network {
    fn new() -> Self {
        Self {
            allowed: AtomicBool::new(true),
            fail: AtomicBool::new(false),
            pages: AtomicUsize::new(0),
        }
    }
}
fn message(id: &str) -> Value {
    json!({"type":"m.room.message","event_id":id,"sender":"@owner:local","origin_server_ts":1000,"content":{"msgtype":"m.text","body":"Authorized original history"}})
}
impl Coordination for Network {
    fn origin(&self) -> &str {
        "https://app.example"
    }
    async fn call(&self, input: &Call, _stop: CancellationToken) -> Result<Value> {
        input.path_parts()?;
        match input.operation {
            OperationId::DeliveryPolicy => Ok(
                json!({"agentId":ID,"backendUserId":"@agent:local","ownerBackendUserId":"@owner:local","maxMessageBytes":65536,"fleetIdleTimeoutSeconds":1800,"status":"active","ownerStatus":"active","ownerConversation":null,"roomGrants":if self.allowed.load(Ordering::SeqCst){vec![json!({"roomId":"!room:local","accessMode":"reply","nativeAccess":null,"muted":false})]}else{vec![]},"wakeMode":"selected","senderBackendUserIds":["@owner:local"]}),
            ),
            OperationId::ResolvePrincipals => Ok(
                json!([{"backendUserId":"@owner:local","kind":"human","ownerBackendUserId":null,"displayName":"Owner","ownerDisplayName":null}]),
            ),
            _ => Err(support::failure()),
        }
    }
}
impl Protocol for Network {
    async fn request(&self, input: &Request, _stop: CancellationToken) -> Result<Response> {
        let body = if input.path.ends_with("/joined_rooms") {
            json!({"joined_rooms":["!room:local"]})
        } else if input.path.ends_with("/sync") {
            json!({"next_batch":"boundary"})
        } else if input.path.ends_with("/state") {
            json!([])
        } else if input.path.ends_with("/account_data/m.direct") {
            json!({})
        } else if input.path.ends_with("/messages") {
            self.pages.fetch_add(1, Ordering::SeqCst);
            match input.query.get("from").map(String::as_str) {
                None => json!({"start":"newest","end":"older","chunk":[message("$newest")]}),
                Some("older") => {
                    if self.fail.load(Ordering::SeqCst) {
                        return Err(Failure::new(
                            ErrorCode::Unavailable,
                            "Explicit fixture interrupted export",
                        ));
                    }
                    json!({"start":"older","end":"oldest","chunk":[message("$older")]})
                }
                _ => return Err(support::failure()),
            }
        } else {
            return Err(support::failure());
        };
        Ok(Response { status: 200, body })
    }
}
fn profile() -> Result<profile::Profile> {
    profile::parse(
        &json!({"id":ID,"workspace":"/workspace/owned","account":{"userId":"@agent:local","accessToken":"private-test-token","native":{"deviceId":"NATIVE"}},"settings":{"instance":"test","server":"https://app.example","backend":{"type":"matrix","parameters":{"origin":"https://app.example","serverName":"local"}},"owner":"@owner:local","maxUploadBytes":16777216}}),
    )
}
#[tokio::test]
async fn complete_reset_exports_are_private_attributed_and_interchangeable_json_without_credentials()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage = support::Memory::default();
    let network = Network::new();
    let profile = profile()?;
    let native = json!({"model":"fixture"});
    let options = Options {
        id: ID,
        root: "/reset",
        runtime: "codex",
        native_options: &native,
        mode: HistoryMode::Shared,
    };
    let exported = reset_history::export(
        &storage,
        &Client::from_protocol(&network, "@agent:local")?,
        &network,
        &profile,
        &options,
        &|| Ok(1000),
        CancellationToken::new(),
    )
    .await?;
    let manifest: Value = serde_json::from_slice(
        &storage
            .read(&exported.manifest, 67108864)?
            .ok_or("Manifest")?,
    )?;
    assert_eq!(manifest["complete"], true);
    assert_eq!(
        manifest["rooms"][0]["pages"]
            .as_array()
            .ok_or("Pages")?
            .len(),
        2
    );
    let configuration = storage
        .read("/reset/configuration.json", 67108864)?
        .ok_or("Configuration")?;
    assert!(!String::from_utf8(configuration)?.contains("private-test-token"));
    let file = manifest["rooms"][0]["pages"][0]["file"]
        .as_str()
        .ok_or("Page filename")?;
    let original = storage.read(file, 67108864)?.ok_or("Page")?;
    assert!(original.ends_with(b"\n"));
    let body = String::from_utf8(original.clone())?;
    assert!(body.contains("@owner:local") && body.contains("!room:local"));
    let before = network.pages.load(Ordering::SeqCst);
    let repeated = reset_history::export(
        &storage,
        &Client::from_protocol(&network, "@agent:local")?,
        &network,
        &profile,
        &options,
        &|| Ok(1000),
        CancellationToken::new(),
    )
    .await?;
    assert_eq!(exported.cursors, repeated.cursors);
    assert_eq!(
        network.pages.load(Ordering::SeqCst),
        before,
        "Retained completed room pages are not downloaded again"
    );
    storage.write(file, b"changed", 67108864)?;
    assert!(
        reset_history::export(
            &storage,
            &Client::from_protocol(&network, "@agent:local")?,
            &network,
            &profile,
            &options,
            &|| Ok(1000),
            CancellationToken::new()
        )
        .await
        .is_err()
    );
    assert_eq!(network.pages.load(Ordering::SeqCst), before);
    storage.write(file, &original, 67108864)?;
    Ok(())
}
#[tokio::test]
async fn interrupted_exports_revalidate_access_before_resuming_or_resetting_any_native_history()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage = support::Memory::default();
    let network = Network::new();
    network.fail.store(true, Ordering::SeqCst);
    let profile = profile()?;
    let native = json!({});
    let options = Options {
        id: ID,
        root: "/reset",
        runtime: "pi",
        native_options: &native,
        mode: HistoryMode::PerRoom,
    };
    assert!(
        reset_history::export(
            &storage,
            &Client::from_protocol(&network, "@agent:local")?,
            &network,
            &profile,
            &options,
            &|| Ok(1000),
            CancellationToken::new()
        )
        .await
        .is_err()
    );
    let before = storage
        .read("/reset/manifest.json", 67108864)?
        .ok_or("Retained incomplete manifest")?;
    network.allowed.store(false, Ordering::SeqCst);
    network.fail.store(false, Ordering::SeqCst);
    let error = reset_history::export(
        &storage,
        &Client::from_protocol(&network, "@agent:local")?,
        &network,
        &profile,
        &options,
        &|| Ok(1000),
        CancellationToken::new(),
    )
    .await
    .err()
    .ok_or("Revoked access must fail")?;
    assert_eq!(error.code, ErrorCode::Forbidden);
    assert_eq!(
        storage
            .read("/reset/manifest.json", 67108864)?
            .ok_or("Original manifest")?,
        before
    );
    network.allowed.store(true, Ordering::SeqCst);
    reset_history::export(
        &storage,
        &Client::from_protocol(&network, "@agent:local")?,
        &network,
        &profile,
        &options,
        &|| Ok(1000),
        CancellationToken::new(),
    )
    .await?;
    Ok(())
}
