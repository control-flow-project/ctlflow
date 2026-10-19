use crossfire_adapter_codex::{context_state, owned::CodexRuntime};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_agent_core::{
    owned_runtime::{Input, OwnedConnection},
    runtime::{Connection, Decision, Hooks, ObservationEvent},
};
use crossfire_domain::{runtime::values::HistoryMode, statistics::Usage};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::Path, sync::Arc};
use tokio_util::sync::CancellationToken;

struct NoInference;
impl Hooks for NoInference {
    async fn request_decision(
        &self,
        _decision: &Decision,
        _cancellation: CancellationToken,
    ) -> Result<Value> {
        Err(Failure::new(
            ErrorCode::Forbidden,
            "Read-only runtime acceptance cannot answer native requests",
        ))
    }
    fn decision_responded(&self, _decision: &Decision) {}
    fn usage(&self, _sample: &Usage) {}
    fn pending_decisions(&self) -> bool {
        false
    }
    fn pending_input(&self) -> bool {
        false
    }
    fn observe(&self, _event: ObservationEvent) {}
}
fn input(workspace: &Path, state: &Path, mode: HistoryMode, fresh: bool) -> Input<NoInference> {
    Input {
        profile: "rust-native-acceptance".to_owned(),
        name: "Rust owned acceptance".to_owned(),
        workspace: workspace.to_owned(),
        state_directory: state.to_owned(),
        instructions:
            "This is a local native-runtime acceptance fixture. Do not call models or tools."
                .to_owned(),
        options: json!({"sandbox_mode":"read-only","approval_policy":"never"}),
        hooks: Arc::new(NoInference),
        history_mode: mode,
        allow_new_history: fresh,
    }
}

#[tokio::test]
async fn actual_stock_codex_shared_owned_runtime_resumes_exact_history_and_explicit_reset_retains_original_native_files()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let state = directory.path().join("state");
    let host = directory.path().join("host");
    PrivateDirectory::open(&state, true)?;
    PrivateDirectory::open(&host, true)?;
    let runtime = CodexRuntime {
        binary: "codex".into(),
        host_home: host,
    };
    let connection = runtime
        .start(
            input(directory.path(), &state, HistoryMode::Shared, true),
            CancellationToken::new(),
        )
        .await?;
    let original = connection.session_id().to_owned();
    assert!(
        runtime
            .start(
                input(directory.path(), &state, HistoryMode::Shared, true),
                CancellationToken::new()
            )
            .await
            .is_err(),
        "A second native owner cannot replace the canonical history binding"
    );
    let first = connection.conversation("control", None).await?;
    let second = connection.conversation("!second:example", None).await?;
    assert_eq!(first.session_id(), original);
    assert_eq!(second.session_id(), original);
    assert_eq!(connection.attachments().await?.len(), 1);
    assert!(!connection.inspect().await?);
    connection.close().await?;
    let resumed = runtime
        .start(
            input(directory.path(), &state, HistoryMode::Shared, false),
            CancellationToken::new(),
        )
        .await?;
    assert_eq!(resumed.session_id(), original);
    resumed.close().await?;
    let home = state.join(".codex");
    let reset_id = identity::id();
    context_state::reset(&home, &reset_id)?;
    context_state::reset(&home, &reset_id)?;
    assert!(
        home.join("crossfire-archive")
            .join(&reset_id)
            .join(context_state::REGISTRY)
            .is_file()
    );
    assert!(home.join("sessions").is_dir());
    let fresh = runtime
        .start(
            input(directory.path(), &state, HistoryMode::Shared, true),
            CancellationToken::new(),
        )
        .await?;
    assert_ne!(fresh.session_id(), original);
    fresh.close().await?;
    Ok(())
}

#[tokio::test]
async fn actual_stock_codex_per_room_owned_histories_have_distinct_persisted_sessions_and_resume_without_new_bindings()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let state = directory.path().join("state");
    let host = directory.path().join("host");
    PrivateDirectory::open(&state, true)?;
    PrivateDirectory::open(&host, true)?;
    let runtime = CodexRuntime {
        binary: "codex".into(),
        host_home: host,
    };
    let connection = runtime
        .start(
            input(directory.path(), &state, HistoryMode::PerRoom, true),
            CancellationToken::new(),
        )
        .await?;
    let primary = connection.session_id().to_owned();
    let first = connection.conversation("control", None).await?;
    let second = connection.conversation("!second:example", None).await?;
    assert_ne!(primary, first.session_id());
    assert_ne!(primary, second.session_id());
    assert_ne!(first.session_id(), second.session_id());
    let saved = connection
        .attachments()
        .await?
        .into_iter()
        .map(|(context, attachment)| (context, attachment.session_id))
        .collect::<BTreeMap<_, _>>();
    assert_eq!(saved.len(), 3);
    connection.close().await?;
    let resumed = runtime
        .start(
            input(directory.path(), &state, HistoryMode::PerRoom, false),
            CancellationToken::new(),
        )
        .await?;
    assert_eq!(resumed.session_id(), primary);
    assert_eq!(
        resumed.conversation("control", None).await?.session_id(),
        saved["room/control"]
    );
    assert_eq!(
        resumed
            .conversation("!second:example", None)
            .await?
            .session_id(),
        saved["room/!second:example"]
    );
    assert_eq!(resumed.attachments().await?.len(), 3);
    resumed.close().await?;
    Ok(())
}

#[test]
fn registry_rejects_duplicate_contexts_and_sessions_and_reset_never_overwrites_archives()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let fixture = tempfile::tempdir()?;
    let home = fixture.path().join("home");
    PrivateDirectory::open(&home, true)?;
    let id = identity::id();
    let mut registry = context_state::Registry {
        mode: "per-room".to_owned(),
        bindings: Vec::new(),
    };
    registry.add("control", &id, HistoryMode::PerRoom)?;
    assert!(
        registry
            .add("!another:example", &id, HistoryMode::PerRoom)
            .is_err()
    );
    assert!(
        registry
            .add("control", &identity::id(), HistoryMode::PerRoom)
            .is_err()
    );
    context_state::save(&home, &registry)?;
    assert!(
        context_state::load(&home)?.0.bindings == registry.bindings,
        "Exact context bindings are retained"
    );
    let reset_id = identity::id();
    let archive = PrivateDirectory::open(&home.join("crossfire-archive").join(&reset_id), true)?;
    archive.write_new(context_state::REGISTRY, b"protected")?;
    assert!(context_state::reset(&home, &reset_id).is_err());
    assert_eq!(archive.read(context_state::REGISTRY, 1024)?, b"protected");
    assert!(
        context_state::load(&home)?.0.bindings == registry.bindings,
        "Failed reset preserves exact context bindings"
    );
    Ok(())
}
