use crossfire_adapter_codex::owned::CodexRuntime;
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_process::execution::NativeExecution;
use crossfire_adapter_runtime::placement::NativePlacement;
use crossfire_agent_core::owned_runtime::Inspection;
use crossfire_kernel::{Failure, failure::ErrorCode};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn rejected_guest_inspection_never_runs_a_host_probe_or_changes_active_credentials()
-> Result<(), Box<dyn std::error::Error>> {
    let root = tempfile::tempdir()?;
    let workspace = root.path().join("workspace");
    let state = root.path().join("state");
    let host = root.path().join("host");
    PrivateDirectory::open(&workspace, true)?;
    PrivateDirectory::open(&state, true)?;
    let source = PrivateDirectory::open(&host, true)?;
    let home = PrivateDirectory::open(&state.join(".codex"), true)?;
    home.write_new("config.toml", b"model_provider='fixture'\nmodel='fixture-model'\n[model_providers.fixture]\nname='Fixture'\nbase_url='http://127.0.0.1:1/v1'\nwire_api='responses'\nrequires_openai_auth=true\n")?;
    let active = b"{\"OPENAI_API_KEY\":\"inert-active-account\"}";
    home.write_new("auth.json", active)?;
    source.write_new(
        "auth.json",
        b"{\"OPENAI_API_KEY\":\"inert-inspection-account\"}",
    )?;
    let rejected = NativeExecution {
        command: Arc::new(|_| {
            Err(Failure::new(
                ErrorCode::Forbidden,
                "Fixture execution rejected",
            ))
        }),
        ..NativeExecution::default()
    };
    let runtime = CodexRuntime {
        binary: "/cannot-run-this-on-the-host".into(),
        host_home: host,
        placement: NativePlacement::local(rejected),
    };
    let result = runtime
        .inspect(
            &Inspection {
                workspace,
                state_directory: state.clone(),
                ownership_directory: root.path().join("control"),
                options: serde_json::json!({"sandbox_mode":"read-only","approval_policy":"never"}),
            },
            CancellationToken::new(),
        )
        .await;
    assert!(
        result.is_err_and(|error| error.code == ErrorCode::Forbidden
            && error.message == "Fixture execution rejected")
    );
    assert_eq!(std::fs::read(state.join(".codex/auth.json"))?, active);
    assert!(
        !std::fs::read_dir(state)?
            .filter_map(std::result::Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with(".codex-inspection-"))
    );
    Ok(())
}

#[tokio::test]
async fn guest_configuration_cannot_authorize_other_host_provider_environment_keys()
-> Result<(), Box<dyn std::error::Error>> {
    use crossfire_adapter_codex::owned_process::{Launch, OwnedProcess};
    use crossfire_adapter_process::ssh_commands::{PROVIDER_KEY, SshExecution};
    use crossfire_adapter_runtime::placement::LeaseRequest;
    use std::{
        ffi::OsStr,
        sync::atomic::{AtomicUsize, Ordering},
    };
    for selected in [Some("CTL_AUTHORIZED_FIXTURE_KEY"), None] {
        let root = tempfile::tempdir()?;
        let state = root.path().join("state");
        PrivateDirectory::open(&state, true)?;
        let home = state.join(".codex");
        PrivateDirectory::open(&home, true)?.write_new("config.toml", b"model_provider='fixture'\n[model_providers.fixture]\nname='Fixture'\nenv_key='CTL_FOREIGN_FIXTURE_KEY'\n")?;
        let host = root.path().join("host");
        let setting = selected.map_or(String::new(), |key| format!("env_key='{key}'\n"));
        PrivateDirectory::open(&host, true)?.write_new(
            "config.toml",
            format!(
                "model_provider='fixture'\n[model_providers.fixture]\nname='Fixture'\n{setting}"
            )
            .as_bytes(),
        )?;
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = calls.clone();
        let execution = NativeExecution {
            command: Arc::new(move |command| {
                assert_eq!(
                    command
                        .environment
                        .get(OsStr::new(PROVIDER_KEY))
                        .and_then(|value| value.as_deref()),
                    selected.map(OsStr::new),
                    "Only the host configuration authorizes provider-key selection"
                );
                observed.fetch_add(1, Ordering::SeqCst);
                Err(Failure::new(
                    ErrorCode::Forbidden,
                    "Fixture rejects execution",
                ))
            }),
            ssh: Some(SshExecution {
                directory: root.path().to_owned(),
                id: crossfire_kernel::identity::id(),
            }),
            ..NativeExecution::default()
        };
        let control = root.path().join("control");
        let lease = (NativePlacement::local(execution).open)(
            LeaseRequest {
                directory: control.clone(),
                workspace: state.clone(),
                state_directory: state.clone(),
                home: home.clone(),
            },
            CancellationToken::new(),
        )
        .await?;
        let retained = lease.clone();
        let result = OwnedProcess::start(
            &Launch {
                home: &home,
                workspace: &state,
                state: &state,
                ownership: &control,
                authentication: &host,
                profile: "fixture",
                binary: OsStr::new("/must-not-run-on-host"),
                questions: false,
            },
            lease,
            CancellationToken::new(),
        )
        .await;
        retained.close().await?;
        assert!(result.is_err_and(|error| error.code == ErrorCode::Forbidden));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
    Ok(())
}
