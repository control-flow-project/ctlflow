use crate::{
    callbacks::SessionCallbacks,
    connection::CodexConnection,
    context_state::{self, Registry},
    input::Input,
    instructions,
    options::{NativeOptions, Options},
    owned_process::OwnedProcess,
    session::{self, Selection, Status},
    websocket::WebSocketProtocol,
};
use crossfire_adapter_filesystem::{PrivateDirectory, lock::StateLock};
use crossfire_adapter_runtime::{
    clock::{self, Scope},
    journal,
};
use crossfire_agent_core::{
    hooks::ContextHooks,
    owned_runtime::Attachment,
    runtime::{Admission, Hooks},
};
use crossfire_domain::runtime::values::{HistoryMode, State};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::json;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

pub type NativeConnection<H> = CodexConnection<WebSocketProtocol, ContextHooks<H>>;
struct Slot<H> {
    connection: OnceLock<Arc<NativeConnection<H>>>,
    opening: tokio::sync::Mutex<()>,
}
impl<H> Default for Slot<H> {
    fn default() -> Self {
        Self {
            connection: OnceLock::new(),
            opening: tokio::sync::Mutex::new(()),
        }
    }
}
struct Contexts<H> {
    registry: Registry,
    slots: BTreeMap<String, Arc<Slot<H>>>,
    monitors: Vec<tokio::task::JoinHandle<()>>,
}
impl<H> Drop for Contexts<H> {
    fn drop(&mut self) {
        for monitor in &self.monitors {
            monitor.abort();
        }
    }
}

pub struct Histories<H> {
    pub home: PathBuf,
    pub workspace: PathBuf,
    pub name: String,
    pub instructions: String,
    pub configured: Options,
    pub mode: HistoryMode,
    pub hooks: Arc<H>,
    pub process: OwnedProcess,
    pub attachment: Attachment,
    ownership: Mutex<Option<StateLock>>,
    contexts: Mutex<Contexts<H>>,
    cancellation: CancellationToken,
}

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}

pub struct Configuration<H> {
    pub ownership: StateLock,
    pub home: PathBuf,
    pub workspace: PathBuf,
    pub name: String,
    pub instructions: String,
    pub configured: Options,
    pub mode: HistoryMode,
    pub hooks: Arc<H>,
    pub process: OwnedProcess,
    pub attachment: Attachment,
    pub allow_new_history: bool,
}

impl<H: Hooks + 'static> Histories<H> {
    pub fn new(input: Configuration<H>, cancellation: CancellationToken) -> Result<Self> {
        PrivateDirectory::open(&input.home, false)?;
        let (registry, exists) = context_state::load(&input.home)?;
        let primary = if input.mode == HistoryMode::Shared {
            "shared"
        } else {
            "control"
        };
        let previous_primary = if registry.mode()? == HistoryMode::Shared {
            "shared"
        } else {
            "control"
        };
        let changing =
            registry.mode()? != input.mode && registry.session(previous_primary).is_some();
        if registry.session(primary).is_none() && !changing && (!input.allow_new_history || exists)
        {
            return Err(Failure::new(
                ErrorCode::Missing,
                "Saved native history is missing. Resume cannot create another history; use the explicit fresh-history operation if intended",
            ));
        }
        if registry.mode()? != input.mode {
            if input.hooks.pending_decisions() {
                return Err(invalid(
                    "Resolve original native decisions before changing history mode",
                ));
            }
            for binding in &registry.bindings {
                let state = journal::read::<Input>(
                    &context_state::receipt(&input.home, &binding.context),
                    &binding.session_id,
                )?;
                if state.pending.is_some() || !state.confirmed.is_empty() {
                    return Err(invalid(
                        "Resolve and acknowledge native publication before changing history mode",
                    ));
                }
            }
        }
        Ok(Self {
            home: input.home,
            workspace: input.workspace,
            name: input.name,
            instructions: input.instructions,
            configured: input.configured,
            mode: input.mode,
            hooks: input.hooks,
            process: input.process,
            attachment: input.attachment,
            ownership: Mutex::new(Some(input.ownership)),
            contexts: Mutex::new(Contexts {
                registry,
                slots: BTreeMap::new(),
                monitors: Vec::new(),
            }),
            cancellation: cancellation.child_token(),
        })
    }

    pub fn lifetime(&self) -> CancellationToken {
        self.cancellation.clone()
    }
    pub fn primary(&self) -> &'static str {
        if self.mode == HistoryMode::Shared {
            "shared"
        } else {
            "control"
        }
    }
    pub fn context<'a>(&'a self, room: Option<&'a str>) -> &'a str {
        if self.mode == HistoryMode::Shared {
            "shared"
        } else {
            room.unwrap_or("control")
        }
    }

    pub async fn open(
        &self,
        context: &str,
        admission: Option<&Admission>,
    ) -> Result<Arc<NativeConnection<H>>> {
        context_state::validate_context(context)?;
        clock::check(&self.lifetime())?;
        let cancellation = admission
            .map(|value| value.cancellation.clone())
            .unwrap_or_else(|| self.lifetime());
        let scope = Scope::new(&self.lifetime(), cancellation);
        clock::check(&scope.cancellation)?;
        let slot = self
            .contexts
            .lock()
            .map_err(|_| invalid("Native history ownership failed"))?
            .slots
            .entry(context.to_owned())
            .or_default()
            .clone();
        if let Some(connection) = slot.connection.get() {
            return Ok(Arc::clone(connection));
        }
        let lock = if admission.is_some() {
            slot.opening.try_lock().map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Exact room history is opening; immediate input has not been accepted",
                )
            })?
        } else {
            tokio::select! { biased; _ = scope.cancellation.cancelled() => return Err(clock::cancelled()), lock = slot.opening.lock() => lock }
        };
        clock::check(&scope.cancellation)?;
        if let Some(connection) = slot.connection.get() {
            return Ok(Arc::clone(connection));
        }
        let previous = self
            .contexts
            .lock()
            .map_err(|_| invalid("Native history ownership failed"))?
            .registry
            .session(context)
            .map(str::to_owned);
        let opened = self
            .create(context, previous.as_deref(), scope.cancellation.clone())
            .await?;
        slot.connection
            .set(Arc::clone(&opened))
            .map_err(|_| invalid("Native context acquired multiple connections"))?;
        drop(lock);
        Ok(opened)
    }

    async fn create(
        &self,
        context: &str,
        previous: Option<&str>,
        cancellation: CancellationToken,
    ) -> Result<Arc<NativeConnection<H>>> {
        let hooks = Arc::new(ContextHooks {
            owner: Arc::clone(&self.hooks),
            context: context.to_owned(),
            extra_settings: self
                .configured
                .bypass
                .map(|bypass| crossfire_domain::runtime::values::Setting {
                    name: "dangerously_bypass_approvals_and_sandbox".to_owned(),
                    configured: Some(bypass.to_string()),
                    effective: None,
                })
                .into_iter()
                .collect(),
        });
        let callbacks = Arc::new(SessionCallbacks::new(
            Arc::clone(&hooks),
            previous,
            cancellation.clone(),
        ));
        let protocol = Arc::new(
            WebSocketProtocol::open(
                &self.process.endpoint,
                &self.process.token,
                Duration::from_secs(30),
                Arc::clone(&callbacks),
                callbacks.lifetime(),
            )
            .await?,
        );
        let name = if context == "shared" {
            self.name.clone()
        } else {
            self.name.clone() + " · " + context
        };
        let selection = previous
            .map(|id| Selection::Resume { id })
            .unwrap_or(Selection::Create { name: &name });
        let session = Arc::new(
            session::open(
                protocol,
                &self.workspace,
                selection,
                &self.configured,
                cancellation.clone(),
            )
            .await?,
        );
        let configuration = serde_json::to_value(NativeOptions(&self.configured))
            .map_err(|_| invalid("Invalid native settings"))?;
        let observed = session.current(cancellation.clone()).await?.status;
        callbacks.selected(&session.id, &configuration, &json!({"model":session.model,"reasoningEffort":session.effort,"sandbox":{"type":self.configured.sandbox.native_type()},"approvalPolicy":self.configured.approval_policy.code()}), session.user_agent.as_deref(), if observed == Status::Active { State::Working } else { State::Idle })?;
        let operation = async {
            {
                let mut contexts = self
                    .contexts
                    .lock()
                    .map_err(|_| invalid("Native registry ownership failed"))?;
                let mut proposed = contexts.registry.clone();
                if previous.is_none() {
                    proposed.add(context, &session.id, self.mode)?;
                }
                proposed.mode = self.mode.code().to_owned();
                context_state::save(&self.home, &proposed)?;
                contexts.registry = proposed;
            }
            let receipt = context_state::receipt(&self.home, context);
            let instructions_file = PathBuf::from(
                receipt
                    .as_os_str()
                    .to_owned()
                    .into_string()
                    .map_err(|_| invalid("Invalid native receipt path"))?
                    + ".instructions",
            );
            instructions::ensure(
                Arc::clone(&session),
                &self.home,
                &instructions_file,
                &self.instructions,
                cancellation.clone(),
            )
            .await?;
            let connection =
                CodexConnection::open(Arc::clone(&session), hooks, &receipt, 1000, 30_000)?;
            if session.current(cancellation).await?.status == Status::NotLoaded {
                return Err(invalid("The selected native history is not loaded"));
            }
            Ok(connection)
        }
        .await;
        if operation.is_err() {
            session.close().await?;
        }
        let connection = operation?;
        let connection = Arc::new(connection);
        let weak = Arc::downgrade(&connection);
        callbacks.forward(move |event| match weak.upgrade() {
            Some(connection) => connection.event(event),
            None => Ok(()),
        })?;
        let native = connection.lifetime();
        let lifetime = self.lifetime();
        let monitor = tokio::spawn(async move {
            tokio::select! { biased; _ = lifetime.cancelled() => {}, _ = native.cancelled() => lifetime.cancel() }
        });
        self.contexts
            .lock()
            .map_err(|_| invalid("Native history ownership failed"))?
            .monitors
            .push(monitor);
        Ok(connection)
    }

    pub fn existing(&self, context: &str) -> Result<Option<Arc<NativeConnection<H>>>> {
        Ok(self
            .contexts
            .lock()
            .map_err(|_| invalid("Native history ownership failed"))?
            .slots
            .get(context)
            .and_then(|slot| slot.connection.get())
            .cloned())
    }
    fn contexts(&self) -> Result<Vec<String>> {
        let contexts = self
            .contexts
            .lock()
            .map_err(|_| invalid("Native history ownership failed"))?;
        let mut keys = contexts
            .registry
            .bindings
            .iter()
            .map(|binding| binding.context.clone())
            .collect::<Vec<_>>();
        keys.extend(contexts.slots.keys().cloned());
        keys.sort_unstable();
        keys.dedup();
        Ok(keys)
    }
    fn unacknowledged(&self, context: &str) -> Result<bool> {
        let contexts = self
            .contexts
            .lock()
            .map_err(|_| invalid("Native history ownership failed"))?;
        let Some(session) = contexts.registry.session(context) else {
            return Ok(false);
        };
        let state = journal::read::<Input>(&context_state::receipt(&self.home, context), session)?;
        Ok(state.pending.is_some() || !state.confirmed.is_empty())
    }
    pub async fn settle(&self, cancellation: CancellationToken) -> Result<bool> {
        let mut received = false;
        for context in self.contexts()? {
            if self.existing(&context)?.is_none() && self.unacknowledged(&context)? {
                self.open(&context, None).await?;
            }
            if let Some(connection) = self.existing(&context)? {
                received = connection.settle(cancellation.clone()).await? || received;
            }
        }
        Ok(received)
    }
    pub fn acknowledge(&self, ids: &[String]) -> Result<()> {
        for context in self.contexts()? {
            if let Some(connection) = self.existing(&context)? {
                connection.acknowledge(ids)?;
            }
        }
        Ok(())
    }
    pub async fn inspect(&self) -> Result<bool> {
        clock::check(&self.lifetime())?;
        if self.hooks.pending_decisions() {
            return Ok(true);
        }
        let before = self.contexts()?;
        let inspector = self
            .existing(self.primary())?
            .ok_or_else(|| invalid("Native activity needs an owned live native connection"))?;
        for context in &before {
            let slot = self
                .contexts
                .lock()
                .map_err(|_| invalid("Native history ownership failed"))?
                .slots
                .get(context)
                .cloned();
            if slot
                .as_ref()
                .is_some_and(|slot| slot.opening.try_lock().is_err())
                || self.unacknowledged(context)?
            {
                return Ok(true);
            }
            if let Some(connection) = self.existing(context)? {
                if connection.unsettled()? || connection.inspect().await? {
                    return Ok(true);
                }
            } else {
                let retained = self
                    .contexts
                    .lock()
                    .map_err(|_| invalid("Native history ownership failed"))?
                    .registry
                    .session(context)
                    .map(str::to_owned);
                if let Some(session) = retained
                    && inspector.inspect_session(&session).await?
                {
                    return Ok(true);
                }
            }
        }
        Ok(before != self.contexts()? || self.hooks.pending_decisions())
    }
    pub fn attachments(&self) -> Result<Vec<(String, Attachment)>> {
        let contexts = self
            .contexts
            .lock()
            .map_err(|_| invalid("Native history ownership failed"))?;
        Ok(contexts
            .registry
            .bindings
            .iter()
            .map(|binding| {
                let mut attachment = self.attachment.clone();
                attachment.session_id = binding.session_id.clone();
                (binding.context.clone(), attachment)
            })
            .collect())
    }
    pub async fn close(&self) -> Result<()> {
        self.cancellation.cancel();
        let slots = self
            .contexts
            .lock()
            .map_err(|_| invalid("Native history ownership failed"))?
            .slots
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut failure = None;
        for slot in slots {
            let _opening = slot.opening.lock().await;
            if let Some(connection) = slot.connection.get()
                && let Err(error) = connection.close().await
            {
                failure.get_or_insert(error);
            }
        }
        if let Err(error) = self.process.close().await {
            failure.get_or_insert(error);
        }
        let monitors = std::mem::take(
            &mut self
                .contexts
                .lock()
                .map_err(|_| invalid("Native history ownership failed"))?
                .monitors,
        );
        for monitor in monitors {
            if monitor.await.is_err() {
                failure.get_or_insert_with(|| {
                    invalid("Native lifetime monitor failed during cleanup")
                });
            }
        }
        self.ownership
            .lock()
            .map_err(|_| invalid("Native owner lock failed during cleanup"))?
            .take();
        failure.map_or(Ok(()), Err)
    }
}
