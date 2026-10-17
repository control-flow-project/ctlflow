use crossfire_adapter_codex::{
    instructions, options,
    owned_process::{Launch, OwnedProcess},
    protocol::{Callbacks, Event, Request},
    session::{self, Selection, Status},
    websocket::WebSocketProtocol,
};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::{ffi::OsStr, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

struct ReadOnly;
impl Callbacks for ReadOnly {
    fn event(&self, _event: Event) {}
    async fn decision(
        &self,
        _request: &Request,
        _cancellation: CancellationToken,
    ) -> Result<Value> {
        Err(Failure::new(
            ErrorCode::Forbidden,
            "Native inspection cannot answer or approve a request",
        ))
    }
    fn responded(&self, _request: &Request) {}
}

#[tokio::test]
async fn actual_stock_codex_owns_a_private_authenticated_process_and_resumes_exact_native_history()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let fixture = tempfile::tempdir()?;
    let home = fixture.path().join("home");
    let state = fixture.path().join("state");
    PrivateDirectory::open(&home, true)?;
    PrivateDirectory::open(&state, true)?;
    let launch = Launch {
        home: &home,
        workspace: fixture.path(),
        state: &state,
        profile: "rust-native-acceptance",
        binary: OsStr::new("codex"),
        questions: true,
    };
    let cancellation = CancellationToken::new();
    let native = OwnedProcess::start(&launch, cancellation.clone()).await?;
    assert!(native.token_file.is_file());
    let protocol = Arc::new(
        WebSocketProtocol::open(
            &native.endpoint,
            &native.token,
            Duration::from_secs(10),
            Arc::new(ReadOnly),
            native.lifetime(),
        )
        .await?,
    );
    let configured =
        options::parse(&json!({"sandbox_mode":"read-only","approval_policy":"never"}))?;
    let session = session::open(
        Arc::clone(&protocol),
        fixture.path(),
        Selection::Create {
            name: "Rust native acceptance",
        },
        &configured,
        cancellation.clone(),
    )
    .await?;
    assert_eq!(
        session.current(cancellation.clone()).await?.status,
        Status::Idle
    );
    assert!(!session.model.is_empty());
    assert!(!session.effort.is_empty());
    let session = Arc::new(session);
    let id = session.id.clone();
    let receipt = state.join("instructions.json");
    let text = "This is a local runtime acceptance fixture. Do not call a model or tools.";
    instructions::ensure(
        Arc::clone(&session),
        &home,
        &receipt,
        text,
        cancellation.clone(),
    )
    .await?;
    instructions::ensure(
        Arc::clone(&session),
        &home,
        &receipt,
        text,
        cancellation.clone(),
    )
    .await?;
    session.close().await?;
    native.close().await?;
    native.close().await?;
    assert!(
        !native.token_file.exists(),
        "Private process credential is removed on close"
    );
    let restarted = OwnedProcess::start(&launch, cancellation.clone()).await?;
    let protocol = Arc::new(
        WebSocketProtocol::open(
            &restarted.endpoint,
            &restarted.token,
            Duration::from_secs(10),
            Arc::new(ReadOnly),
            restarted.lifetime(),
        )
        .await?,
    );
    let restored = session::open(
        protocol,
        fixture.path(),
        Selection::Resume { id: &id },
        &configured,
        cancellation.clone(),
    )
    .await?;
    assert_eq!(restored.id, id);
    assert_eq!(
        restored.current(cancellation.clone()).await?.status,
        Status::Idle
    );
    let restored = Arc::new(restored);
    instructions::ensure(
        Arc::clone(&restored),
        &home,
        &receipt,
        text,
        cancellation.clone(),
    )
    .await?;
    let history = restored
        .current(cancellation)
        .await?
        .history
        .ok_or("Actual native history")?;
    let mut injected = 0;
    crossfire_adapter_runtime::history::since(&history, None, |value| {
        if value["type"] == "response_item"
            && value["payload"]["role"] == "developer"
            && value["payload"]["content"][0]["text"].as_str() == Some(text)
        {
            injected += 1;
        }
        Ok(())
    })?;
    assert_eq!(
        injected, 1,
        "Receipt-confirmed native instructions are not duplicated after restart"
    );
    restored.close().await?;
    restarted.close().await?;
    assert!(!restarted.token_file.exists());
    Ok(())
}
