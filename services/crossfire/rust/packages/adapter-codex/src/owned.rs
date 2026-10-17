use crate::{
    admission, context_state,
    histories::{self, Histories, NativeConnection},
    home,
    options::{self, NativeOptions},
    owned_process::{Launch, OwnedProcess},
    protocol::{Callbacks, Event, Protocol, Request},
    session,
    websocket::WebSocketProtocol,
};
use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock};
use crossfire_adapter_process::NativeCommand;
use crossfire_adapter_runtime::clock;
use crossfire_agent_core::{
    owned_runtime::{
        Attachment, Input, Inspection, OwnedAdapter, OwnedConnection, Reset, SavedContext,
        Validation,
    },
    runtime::{
        Admission, Approval, Connection, Hooks, InputPriority, InterruptResult, TurnControl,
    },
};
use crossfire_domain::runtime::values::Setting;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio_util::sync::CancellationToken;

pub struct CodexRuntime {
    pub binary: OsString,
    pub host_home: PathBuf,
}
pub struct CodexOwnedConnection<H> {
    histories: Arc<Histories<H>>,
    connection: Arc<NativeConnection<H>>,
    root: bool,
}

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn directories(workspace: &Path, state: &Path) -> Result<()> {
    if !workspace.is_absolute()
        || std::fs::canonicalize(workspace)
            .map_err(|_| invalid("Native workspace does not exist"))?
            .as_os_str()
            != workspace.as_os_str()
        || !std::fs::metadata(workspace)
            .map_err(|_| invalid("Native workspace does not exist"))?
            .is_dir()
    {
        return Err(invalid(
            "Use an exact existing native workspace without symbolic links",
        ));
    }
    PrivateDirectory::open(state, false)?;
    Ok(())
}
struct InspectionCallbacks;
impl Callbacks for InspectionCallbacks {
    fn event(&self, _event: Event) {}
    async fn decision(
        &self,
        _request: &Request,
        _cancellation: CancellationToken,
    ) -> Result<Value> {
        Err(Failure::new(
            ErrorCode::Forbidden,
            "Capability inspection cannot answer or approve native requests",
        ))
    }
    fn responded(&self, _request: &Request) {}
}

impl CodexRuntime {
    pub async fn inspect(&self, input: &Inspection, cancellation: CancellationToken) -> Result<()> {
        let configured = options::parse(&input.options)?;
        clock::check(&cancellation)?;
        directories(&input.workspace, &input.state_directory)?;
        let home = home::prepare(&input.state_directory, &self.host_home)?;
        let configuration = home::read(&home)?;
        let provider = home::provider(&configuration)?;
        if let Some(key) = provider
            .settings
            .and_then(|settings| settings.get("env_key"))
        {
            let key = key
                .as_str()
                .filter(|value| {
                    !value.is_empty()
                        && value.bytes().enumerate().all(|(index, value)| {
                            value.is_ascii_alphabetic()
                                || value == b'_'
                                || index > 0 && value.is_ascii_digit()
                        })
                })
                .ok_or_else(|| {
                    invalid("The native provider API-key environment variable is invalid")
                })?;
            if !std::env::var(key).is_ok_and(|value| !value.trim().is_empty()) {
                return Err(invalid(
                    "The native model provider requires its private API-key environment variable; configure it before setup",
                ));
            }
        }
        if provider.id == "openai"
            || provider
                .settings
                .and_then(|settings| settings.get("requires_openai_auth"))
                .and_then(crossfire_adapter_toml::Value::as_bool)
                == Some(true)
        {
            let result = crossfire_adapter_process::capture(
                &NativeCommand {
                    binary: self.binary.clone(),
                    arguments: vec!["login".into(), "status".into()],
                    workspace: input.workspace.clone(),
                    input: false,
                    environment: BTreeMap::from([
                        (
                            "CODEX_HOME".into(),
                            Some(self.host_home.as_os_str().to_owned()),
                        ),
                        (
                            "CROSSFIRE_PROJECT".into(),
                            Some(input.state_directory.as_os_str().to_owned()),
                        ),
                        ("CODEX_THREAD_ID".into(), None),
                        ("CROSSFIRE_AGENT_NAME".into(), None),
                    ]),
                },
                65_536,
                Duration::from_secs(10),
                cancellation.clone(),
            )
            .await?;
            if !result.status.success() {
                return Err(Failure::new(
                    ErrorCode::Unauthorized,
                    "Sign in with codex login using the host CODEX_HOME, then repeat setup or resume. Never paste credentials into chat",
                ));
            }
        }
        let fixture = tempfile::Builder::new()
            .prefix(".codex-inspection-")
            .permissions(std::fs::Permissions::from_mode(0o700))
            .tempdir_in(&input.state_directory)
            .map_err(|_| invalid("Cannot prepare private native inspection"))?;
        let selected = crossfire_adapter_toml::format(&configuration)?;
        PrivateDirectory::open(fixture.path(), false)?
            .write_new("config.toml", selected.as_bytes())?;
        home::refresh_authentication(fixture.path(), &self.host_home)?;
        let native = OwnedProcess::start(
            &Launch {
                home: fixture.path(),
                workspace: &input.workspace,
                state: &input.state_directory,
                profile: "crossfire-inspection",
                binary: &self.binary,
                questions: configured
                    .features
                    .as_ref()
                    .and_then(|features| features.default_mode_request_user_input)
                    == Some(true),
            },
            cancellation.clone(),
        )
        .await?;
        let operation = async {
            let protocol = WebSocketProtocol::open(&native.endpoint, &native.token, Duration::from_secs(10), Arc::new(InspectionCallbacks), native.lifetime()).await?;
            let result = async {
                session::value(&protocol, "initialize", &json!({"clientInfo":{"name":"crossfire-inspection","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}}), cancellation.clone()).await?;
                protocol.notify("initialized", cancellation.clone()).await?;
                admission::admit(&protocol, &configured, cancellation).await?; Ok(())
            }.await;
            protocol.close().await?; result
        }.await;
        native.close().await?;
        operation
    }

    pub async fn start<H: Hooks + 'static>(
        &self,
        input: Input<H>,
        cancellation: CancellationToken,
    ) -> Result<CodexOwnedConnection<H>> {
        let configured = options::parse(&input.options)?;
        if input.profile.is_empty()
            || input.profile.len() > 40
            || !input.profile.bytes().enumerate().all(|(index, value)| {
                value.is_ascii_lowercase() || index > 0 && (value.is_ascii_digit() || value == b'-')
            })
        {
            return Err(invalid(
                "Native tools require the immutable controller-assigned profile",
            ));
        }
        clock::check(&cancellation)?;
        directories(&input.workspace, &input.state_directory)?;
        let home = home::prepare(&input.state_directory, &self.host_home)?;
        let ownership = StateLock::acquire(&home.join("owner"))?;
        home::refresh_authentication(&home, &self.host_home)?;
        let native = OwnedProcess::start(
            &Launch {
                home: &home,
                workspace: &input.workspace,
                state: &input.state_directory,
                profile: &input.profile,
                binary: &self.binary,
                questions: configured
                    .features
                    .as_ref()
                    .and_then(|features| features.default_mode_request_user_input)
                    == Some(true),
            },
            cancellation,
        )
        .await?;
        let lifetime = native.lifetime();
        let attachment = Attachment {
            runtime: "codex".to_owned(),
            session_id: String::new(),
            workspace: input.workspace.clone(),
            connection: BTreeMap::from([
                ("endpoint".to_owned(), native.endpoint.clone()),
                (
                    "tokenFile".to_owned(),
                    native
                        .token_file
                        .to_str()
                        .ok_or_else(|| invalid("Native attachment paths must be exact UTF-8"))?
                        .to_owned(),
                ),
                (
                    "home".to_owned(),
                    home.to_str()
                        .ok_or_else(|| invalid("Native attachment home must be exact UTF-8"))?
                        .to_owned(),
                ),
                (
                    "binary".to_owned(),
                    self.binary
                        .to_str()
                        .ok_or_else(|| invalid("Native executable must be exact UTF-8"))?
                        .to_owned(),
                ),
                (
                    "path".to_owned(),
                    std::env::var("PATH")
                        .map_err(|_| invalid("Native executable PATH is unavailable"))?,
                ),
            ]),
        };
        let histories = Arc::new(Histories::new(
            histories::Configuration {
                ownership,
                home,
                workspace: input.workspace,
                name: input.name,
                instructions: input.instructions,
                configured,
                mode: input.history_mode,
                hooks: input.hooks,
                process: native,
                attachment,
                allow_new_history: input.allow_new_history,
            },
            lifetime,
        )?);
        let primary = histories.open(histories.primary(), None).await;
        if primary.is_err() {
            histories.close().await?;
        }
        Ok(CodexOwnedConnection {
            histories,
            connection: primary?,
            root: true,
        })
    }
}

impl<H: Hooks + 'static> OwnedAdapter<H> for CodexRuntime {
    type Connection = CodexOwnedConnection<H>;
    fn configured_settings(&self, options: &Value) -> Result<Vec<Setting>> {
        options::parse(options)?;
        Ok(options
            .as_object()
            .ok_or_else(|| invalid("Invalid native settings"))?
            .iter()
            .filter(|(name, _)| {
                [
                    "model",
                    "model_reasoning_effort",
                    "sandbox_mode",
                    "approval_policy",
                    "dangerously_bypass_approvals_and_sandbox",
                ]
                .contains(&name.as_str())
            })
            .map(|(name, value)| Setting {
                name: name.clone(),
                configured: Some(
                    value
                        .as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| value.to_string()),
                ),
                effective: None,
            })
            .collect())
    }
    fn validate(&self, configured: &Value) -> Result<Validation> {
        let parsed = options::parse(configured)?;
        Ok(Validation {
            options: serde_json::to_value(NativeOptions(&parsed))
                .map_err(|_| invalid("Invalid native configuration"))?,
            approval: parsed.approval_policy.routing(),
        })
    }
    async fn inspect(&self, input: &Inspection, cancellation: CancellationToken) -> Result<()> {
        self.inspect(input, cancellation).await
    }
    async fn saved_contexts(&self, input: &Inspection) -> Result<Vec<SavedContext>> {
        directories(&input.workspace, &input.state_directory)?;
        context_state::saved(&input.state_directory.join(".codex"), &input.workspace)
    }
    async fn reset(&self, input: &Reset) -> Result<()> {
        directories(&input.workspace, &input.state_directory)?;
        let home = home::prepare(&input.state_directory, &self.host_home)?;
        let _owner = StateLock::acquire(&home.join("owner"))?;
        context_state::reset(&home, &input.reset_id)
    }
    async fn start(
        &self,
        input: Input<H>,
        cancellation: CancellationToken,
    ) -> Result<Self::Connection> {
        self.start(input, cancellation).await
    }
}

impl<H: Hooks + 'static> Connection for CodexOwnedConnection<H> {
    fn session_id(&self) -> &str {
        self.connection.session_id()
    }
    fn approval(&self) -> Approval {
        self.connection.approval()
    }
    fn lifetime(&self) -> CancellationToken {
        self.histories.lifetime()
    }
    async fn inspect(&self) -> Result<bool> {
        self.histories.inspect().await
    }
    async fn deliver(
        &self,
        text: &str,
        id: &str,
        cancellation: CancellationToken,
        priority: Option<InputPriority>,
    ) -> Result<()> {
        self.connection
            .deliver(text, id, cancellation, priority)
            .await
    }
    async fn settle(&self, cancellation: CancellationToken) -> Result<bool> {
        self.histories.settle(cancellation).await
    }
    async fn recover(&self, text: &str, id: &str, cancellation: CancellationToken) -> Result<bool> {
        self.connection.recover(text, id, cancellation).await
    }
    fn acknowledge(&self, ids: &[String]) -> Result<()> {
        self.histories.acknowledge(ids)
    }
    async fn conversation(&self, room: &str, admission: Option<&Admission>) -> Result<Self> {
        let connection = self
            .histories
            .open(self.histories.context(Some(room)), admission)
            .await?;
        Ok(Self {
            histories: Arc::clone(&self.histories),
            connection,
            root: false,
        })
    }
    async fn close(&self) -> Result<()> {
        if self.root {
            self.histories.close().await
        } else {
            self.connection.close().await
        }
    }
}
impl<H: Hooks + 'static> OwnedConnection for CodexOwnedConnection<H> {
    fn attachment(&self) -> Option<Attachment> {
        let mut attachment = self.histories.attachment.clone();
        attachment.session_id = self.session_id().to_owned();
        Some(attachment)
    }
    async fn attachments(&self) -> Result<Vec<(String, Attachment)>> {
        self.histories.attachments()
    }
}
impl<H: Hooks + 'static> TurnControl for CodexOwnedConnection<H> {
    async fn active_turn(
        &self,
        room: Option<&str>,
        admission: Option<&Admission>,
    ) -> Result<Option<String>> {
        let context = self.histories.context(room);
        let connection = if admission.is_some() {
            Some(self.histories.open(context, admission).await?)
        } else {
            self.histories.existing(context)?
        };
        let turn = match connection {
            Some(connection) => connection.active_turn(None, admission).await?,
            None => None,
        };
        turn.map(|turn| {
            serde_json::to_string(&json!([context, turn]))
                .map_err(|_| invalid("Invalid native captured turn"))
        })
        .transpose()
    }
    async fn interrupt(
        &self,
        turn: &str,
        recovery: bool,
        admission: Option<&Admission>,
    ) -> Result<InterruptResult> {
        if turn.len() > 2048 {
            return Err(invalid("Invalid captured native history and turn"));
        }
        let captured: (String, String) = serde_json::from_str(turn)
            .map_err(|_| invalid("Invalid captured native history and turn"))?;
        if !self
            .histories
            .attachments()?
            .iter()
            .any(|(context, _)| context == &captured.0)
        {
            return Err(invalid("Captured native history does not exist"));
        }
        self.histories
            .open(&captured.0, admission)
            .await?
            .interrupt(&captured.1, recovery, admission)
            .await
    }
}
