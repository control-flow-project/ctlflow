use crate::{
    histories::{self, Histories, NativeConnection},
    home, options, state,
};
use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock};
use crossfire_adapter_runtime::clock;
use crossfire_agent_core::{
    owned_runtime::{
        Attachment, Input, Inspection, NativeActivity, OwnedAdapter, OwnedConnection, Reset,
        SavedContext, Validation,
    },
    runtime::{
        Admission, Approval, Connection, Decision, Hooks, InputPriority, InterruptResult,
        ObservationEvent, TurnControl,
    },
};
use crossfire_domain::{
    runtime::values::{HistoryMode, Setting},
    statistics::Usage,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

pub struct PiRuntime {
    pub binary: OsString,
    pub host_home: PathBuf,
}
struct Owner<H> {
    histories: Histories<H>,
    lock: Mutex<Option<StateLock>>,
}
pub struct PiOwnedConnection<H> {
    owner: Arc<Owner<H>>,
    connection: Arc<NativeConnection<H>>,
    context: String,
    root: bool,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn directories(workspace: &Path, state: &Path) -> Result<()> {
    if !workspace.is_absolute()
        || std::fs::canonicalize(workspace)
            .map_err(|_| invalid("Pi workspace does not exist"))?
            .as_os_str()
            != workspace.as_os_str()
        || !std::fs::metadata(workspace)
            .map_err(|_| invalid("Pi workspace does not exist"))?
            .is_dir()
    {
        return Err(invalid(
            "Pi requires an exact existing workspace without symbolic links",
        ));
    }
    PrivateDirectory::open(state, false)?;
    Ok(())
}
struct InspectionHooks;
impl Hooks for InspectionHooks {
    async fn request_decision(
        &self,
        _decision: &Decision,
        _cancellation: CancellationToken,
    ) -> Result<Value> {
        Err(Failure::new(
            ErrorCode::Forbidden,
            "Capability inspection cannot answer native decisions",
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

impl PiRuntime {
    pub async fn inspect(&self, input: &Inspection, cancellation: CancellationToken) -> Result<()> {
        options::parse(&input.options)?;
        clock::check(&cancellation)?;
        directories(&input.workspace, &input.state_directory)?;
        let directory = tempfile::Builder::new()
            .prefix(".pi-inspection-")
            .permissions(std::fs::Permissions::from_mode(0o700))
            .tempdir_in(&input.state_directory)
            .map_err(|_| invalid("Cannot prepare private Pi inspection"))?;
        let connection = self
            .start(
                Input {
                    profile: "crossfire-inspection".to_owned(),
                    name: "crossfire-inspection".to_owned(),
                    workspace: input.workspace.clone(),
                    state_directory: directory.path().to_owned(),
                    instructions: "Capability inspection only. No model work is authorized."
                        .to_owned(),
                    options: input.options.clone(),
                    hooks: Arc::new(InspectionHooks),
                    history_mode: HistoryMode::Shared,
                    allow_new_history: true,
                },
                cancellation,
            )
            .await?;
        connection.close().await
    }
    pub async fn start<H: Hooks + 'static>(
        &self,
        input: Input<H>,
        cancellation: CancellationToken,
    ) -> Result<PiOwnedConnection<H>> {
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
        let home = home::prepare(&input.state_directory)?;
        let lock = StateLock::acquire(&home.join("owner"))?;
        home::refresh(&home, &self.host_home)?;
        let histories = Histories::new(
            histories::Configuration {
                binary: self.binary.clone(),
                home,
                workspace: input.workspace,
                state_directory: input.state_directory,
                profile: input.profile,
                instructions: input.instructions,
                options: configured,
                hooks: input.hooks,
                mode: input.history_mode,
                allow_new_history: input.allow_new_history,
            },
            cancellation,
        )?;
        let connection = histories.open(histories.primary(), None).await;
        if connection.is_err() {
            histories.close().await?;
        }
        Ok(PiOwnedConnection {
            connection: connection?,
            context: histories.primary().to_owned(),
            owner: Arc::new(Owner {
                histories,
                lock: Mutex::new(Some(lock)),
            }),
            root: true,
        })
    }
    pub fn saved(&self, input: &Inspection) -> Result<Vec<SavedContext>> {
        directories(&input.workspace, &input.state_directory)?;
        let home = home::prepare(&input.state_directory)?;
        let mut registry = state::load(&home)?.0;
        let mut contexts = Vec::new();
        for binding in &mut registry.bindings {
            state::read_binding(&home, binding, &input.workspace)?;
            if let Some(session) = &binding.session_id {
                contexts.push(SavedContext {
                    context: binding.context.clone(),
                    runtime: "pi".to_owned(),
                    session_id: session.clone(),
                    workspace: input.workspace.clone(),
                });
            }
        }
        Ok(contexts)
    }
    pub fn reset(&self, input: &Reset) -> Result<()> {
        crossfire_contracts::validation::identifier(&json!(input.reset_id))?;
        directories(&input.workspace, &input.state_directory)?;
        let home = home::prepare(&input.state_directory)?;
        let _owner = StateLock::acquire(&home.join("owner"))?;
        state::load(&home)?;
        let directory = PrivateDirectory::open(&home, false)?;
        if let Some(marker) = directory.read_optional("crossfire-reset.json", 1024)? {
            let marker: Value =
                serde_json::from_slice(&marker).map_err(|_| invalid("Invalid Pi reset marker"))?;
            if marker["resetId"] == input.reset_id {
                return Ok(());
            }
        }
        let target = PrivateDirectory::open(&home.join("archive").join(&input.reset_id), true)?;
        for name in directory.names(20_000)?.into_iter().filter(|name| {
            ["crossfire-contexts.json", "histories", "receipts"].contains(&name.as_str())
        }) {
            directory.move_entry(&name, &target)?;
        }
        directory.write_atomic(
            "crossfire-reset.json",
            &serde_json::to_vec(&json!({"resetId":input.reset_id}))
                .map_err(|_| invalid("Invalid Pi reset identity"))?,
        )
    }
}
impl<H: Hooks + 'static> OwnedAdapter<H> for PiRuntime {
    type Connection = PiOwnedConnection<H>;
    fn configured_settings(&self, value: &Value) -> Result<Vec<Setting>> {
        Ok(options::settings(&options::parse(value)?))
    }
    fn validate(&self, value: &Value) -> Result<Validation> {
        Ok(Validation {
            options: serde_json::to_value(options::parse(value)?)
                .map_err(|_| invalid("Invalid Pi configuration"))?,
            approval: Approval::None,
        })
    }
    async fn inspect(&self, input: &Inspection, cancellation: CancellationToken) -> Result<()> {
        self.inspect(input, cancellation).await
    }
    async fn saved_contexts(&self, input: &Inspection) -> Result<Vec<SavedContext>> {
        self.saved(input)
    }
    async fn reset(&self, input: &Reset) -> Result<()> {
        self.reset(input)
    }
    async fn start(
        &self,
        input: Input<H>,
        cancellation: CancellationToken,
    ) -> Result<Self::Connection> {
        self.start(input, cancellation).await
    }
}
impl<H: Hooks + 'static> Connection for PiOwnedConnection<H> {
    fn session_id(&self) -> &str {
        self.connection.session_id()
    }
    fn approval(&self) -> Approval {
        Approval::None
    }
    fn lifetime(&self) -> CancellationToken {
        self.owner.histories.lifetime()
    }
    async fn inspect(&self) -> Result<bool> {
        Ok(self.owner.histories.activity().await?.busy)
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
        self.owner.histories.settle(cancellation).await
    }
    async fn recover(&self, text: &str, id: &str, cancellation: CancellationToken) -> Result<bool> {
        self.connection.recover(text, id, cancellation).await
    }
    fn acknowledge(&self, ids: &[String]) -> Result<()> {
        self.owner.histories.acknowledge(ids)
    }
    async fn conversation(&self, room: &str, admission: Option<&Admission>) -> Result<Self> {
        Ok(Self {
            owner: Arc::clone(&self.owner),
            context: self.owner.histories.context(Some(room)).to_owned(),
            connection: self
                .owner
                .histories
                .open(&self.owner.histories.context(Some(room)), admission)
                .await?,
            root: false,
        })
    }
    async fn close(&self) -> Result<()> {
        if self.root {
            let result = self.owner.histories.close().await;
            self.owner
                .lock
                .lock()
                .map_err(|_| invalid("Pi native owner lock failed during cleanup"))?
                .take();
            result
        } else {
            self.connection.close().await
        }
    }
}
impl<H: Hooks + 'static> OwnedConnection for PiOwnedConnection<H> {
    async fn provider(
        &self,
        cancellation: CancellationToken,
    ) -> Result<crossfire_agent_core::owned_runtime::ProviderState> {
        self.connection.provider(cancellation).await
    }
    async fn activity(&self) -> Result<NativeActivity> {
        self.owner.histories.activity().await
    }
    fn attachment(&self) -> Option<Attachment> {
        None
    }
    async fn attachments(&self) -> Result<Vec<(String, Attachment)>> {
        Ok(Vec::new())
    }
}
impl<H: Hooks + 'static> TurnControl for PiOwnedConnection<H> {
    async fn active_turn(
        &self,
        room: Option<&str>,
        admission: Option<&Admission>,
    ) -> Result<Option<String>> {
        let context = room
            .map(|room| self.owner.histories.context(Some(room)))
            .unwrap_or_else(|| self.context.clone());
        let connection = if admission.is_some() {
            Some(self.owner.histories.open(&context, admission).await?)
        } else {
            self.owner.histories.existing(&context)?
        };
        let turn = match connection {
            Some(connection) => connection.active_turn(None, admission).await?,
            None => None,
        };
        turn.map(|turn| {
            serde_json::to_string(&json!([context, turn]))
                .map_err(|_| invalid("Invalid Pi captured turn"))
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
            return Err(invalid("Invalid captured Pi context and execution"));
        }
        let captured: (String, String) = serde_json::from_str(turn)
            .map_err(|_| invalid("Invalid captured Pi context and execution"))?;
        if !self.owner.histories.contexts()?.contains(&captured.0) {
            return Err(invalid("Captured Pi history does not exist"));
        }
        self.owner
            .histories
            .open(&captured.0, admission)
            .await?
            .interrupt(&captured.1, recovery, admission)
            .await
    }
}
