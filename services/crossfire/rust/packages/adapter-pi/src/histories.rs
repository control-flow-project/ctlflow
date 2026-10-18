use crate::{
    admission,
    callbacks::NativeEvents,
    connection::{self, Input, PiConnection},
    options::Options,
    protocol::{Launch, Protocol, Rpc},
    state::{self, Registry},
};
use crossfire_adapter_filesystem::{PrivateDirectory, owned::OwnedFile};
use crossfire_adapter_runtime::{
    clock::{self, Scope},
    history, journal,
};
use crossfire_agent_core::{
    hooks::ContextHooks,
    owned_runtime::{NativeActivity, NativeContextActivity},
    runtime::{Admission, Hooks},
};
use crossfire_domain::runtime::values::{HistoryMode, State};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    path::PathBuf,
    sync::{Arc, Mutex, OnceLock},
};
use tokio_util::sync::CancellationToken;

pub type NativeConnection<H> = PiConnection<Rpc, ContextHooks<H>>;
struct Opened<H> {
    connection: Arc<NativeConnection<H>>,
    events: Arc<NativeEvents<ContextHooks<H>>>,
}
struct Slot<H> {
    opened: OnceLock<Opened<H>>,
    opening: tokio::sync::Mutex<()>,
}
impl<H> Default for Slot<H> {
    fn default() -> Self {
        Self {
            opened: OnceLock::new(),
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

pub struct Configuration<H> {
    pub binary: OsString,
    pub home: PathBuf,
    pub workspace: PathBuf,
    pub state_directory: PathBuf,
    pub profile: String,
    pub instructions: String,
    pub options: Options,
    pub hooks: Arc<H>,
    pub mode: HistoryMode,
    pub allow_new_history: bool,
}
pub struct Histories<H> {
    pub configuration: Configuration<H>,
    contexts: Mutex<Contexts<H>>,
    cancellation: CancellationToken,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}

impl<H: Hooks + 'static> Histories<H> {
    pub fn new(configuration: Configuration<H>, cancellation: CancellationToken) -> Result<Self> {
        let (registry, exists) = state::load(&configuration.home)?;
        if registry.mode != configuration.mode.code() {
            if configuration.hooks.pending_decisions() {
                return Err(invalid(
                    "Resolve original Pi decisions before changing history mode",
                ));
            }
            for binding in &registry.bindings {
                if let Some(session) = &binding.session_id {
                    let receipt = Self::receipt_path(&configuration.home, &binding.context);
                    let journal = journal::read::<Input>(&receipt, session)?;
                    if journal.pending.is_some() || !journal.confirmed.is_empty() {
                        return Err(invalid(
                            "Acknowledge original Pi publication before changing history mode",
                        ));
                    }
                }
            }
        }
        let primary = if configuration.mode == HistoryMode::Shared {
            "shared"
        } else {
            "control"
        };
        if !registry
            .bindings
            .iter()
            .any(|binding| binding.context == primary)
            && registry.mode == configuration.mode.code()
            && (!configuration.allow_new_history || exists)
        {
            return Err(Failure::new(
                ErrorCode::Missing,
                "Saved Pi history is missing; resume cannot create another history. Use explicit fresh history if intended",
            ));
        }
        PrivateDirectory::open(&configuration.home.join("receipts"), true)?;
        Ok(Self {
            configuration,
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
        if self.configuration.mode == HistoryMode::Shared {
            "shared"
        } else {
            "control"
        }
    }
    pub fn context<'a>(&'a self, room: Option<&'a str>) -> &'a str {
        if self.configuration.mode == HistoryMode::Shared {
            "shared"
        } else {
            room.unwrap_or("control")
        }
    }
    fn receipt_path(home: &std::path::Path, context: &str) -> PathBuf {
        home.join("receipts")
            .join(journal::digest(context) + ".json")
    }
    pub fn existing(&self, context: &str) -> Result<Option<Arc<NativeConnection<H>>>> {
        Ok(self
            .contexts
            .lock()
            .map_err(|_| invalid("Pi history ownership failed"))?
            .slots
            .get(context)
            .and_then(|slot| slot.opened.get())
            .map(|opened| Arc::clone(&opened.connection)))
    }
    pub async fn open(
        &self,
        context: &str,
        admission: Option<&Admission>,
    ) -> Result<Arc<NativeConnection<H>>> {
        state::allocate(context)?;
        clock::check(&self.lifetime())?;
        let scope = Scope::new(
            &self.lifetime(),
            admission
                .map(|value| value.cancellation.clone())
                .unwrap_or_else(|| self.lifetime()),
        );
        let slot = self
            .contexts
            .lock()
            .map_err(|_| invalid("Pi history ownership failed"))?
            .slots
            .entry(context.to_owned())
            .or_default()
            .clone();
        if let Some(opened) = slot.opened.get() {
            return Ok(Arc::clone(&opened.connection));
        }
        let lock = if admission.is_some() {
            slot.opening.try_lock().map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Exact Pi room history is opening; immediate input has not been accepted",
                )
            })?
        } else {
            tokio::select! { biased; _ = scope.cancellation.cancelled() => return Err(clock::cancelled()), lock = slot.opening.lock() => lock }
        };
        clock::check(&scope.cancellation)?;
        if let Some(opened) = slot.opened.get() {
            return Ok(Arc::clone(&opened.connection));
        }
        let opened = self.create(context, scope.cancellation.clone()).await?;
        let connection = Arc::clone(&opened.connection);
        slot.opened
            .set(opened)
            .map_err(|_| invalid("Pi context acquired competing native owners"))?;
        drop(lock);
        Ok(connection)
    }
    async fn create(&self, context: &str, cancellation: CancellationToken) -> Result<Opened<H>> {
        let binding = {
            let mut contexts = self
                .contexts
                .lock()
                .map_err(|_| invalid("Pi registry ownership failed"))?;
            let mut proposed = contexts.registry.clone();
            let index = match proposed
                .bindings
                .iter()
                .position(|binding| binding.context == context)
            {
                Some(index) => index,
                None => {
                    if proposed.bindings.len() >= 2002 {
                        return Err(invalid("Pi room history budget is exhausted"));
                    }
                    proposed.bindings.push(state::allocate(context)?);
                    proposed.bindings.len() - 1
                }
            };
            state::initialize(
                &self.configuration.home,
                &mut proposed.bindings[index],
                &self.configuration.workspace,
            )?;
            state::save(&self.configuration.home, &proposed)?;
            let binding = proposed.bindings[index].clone();
            contexts.registry = proposed;
            binding
        };
        let history_file = state::history(&self.configuration.home, &binding);
        let hooks = Arc::new(ContextHooks {
            owner: Arc::clone(&self.configuration.hooks),
            context: context.to_owned(),
            extra_settings: Vec::new(),
        });
        let events = Arc::new(NativeEvents::new(
            Arc::clone(&hooks),
            binding.session_id.as_deref(),
        ));
        let native = Arc::new(
            Rpc::start(
                &Launch {
                    binary: &self.configuration.binary,
                    workspace: &self.configuration.workspace,
                    state: &self.configuration.state_directory,
                    home: &self.configuration.home,
                    profile: &self.configuration.profile,
                    history: &history_file,
                    instructions: &self.configuration.instructions,
                },
                Arc::clone(&events),
                cancellation.clone(),
            )
            .await?,
        );
        events.bind_native(&native)?;
        let operation = async {
            let selected = admission::admit(
                native.as_ref(),
                &self.configuration.options,
                cancellation.clone(),
            )
            .await?;
            let id = selected
                .state
                .get("sessionId")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("Pi did not expose its exact native session"))?;
            if binding
                .session_id
                .as_ref()
                .is_some_and(|original| original != id)
                || selected.state.get("sessionFile").and_then(Value::as_str)
                    != history_file.to_str()
            {
                return Err(invalid(
                    "Pi substituted its native session identity or path",
                ));
            }
            state::verify(&history_file, &self.configuration.workspace, id)?;
            OwnedFile::open(&history_file, u64::MAX)?
                .ok_or_else(|| invalid("Pi history disappeared"))?
                .secure_and_sync()?;
            {
                let mut contexts = self
                    .contexts
                    .lock()
                    .map_err(|_| invalid("Pi registry ownership failed"))?;
                let mut proposed = contexts.registry.clone();
                if proposed.bindings.iter().any(|value| {
                    value.context != context && value.session_id.as_deref() == Some(id)
                }) {
                    return Err(invalid("Pi reused another native history identity"));
                }
                proposed
                    .bindings
                    .iter_mut()
                    .find(|value| value.context == context)
                    .ok_or_else(|| invalid("Pi history binding disappeared"))?
                    .session_id = Some(id.to_owned());
                proposed.mode = self.configuration.mode.code().to_owned();
                state::save(&self.configuration.home, &proposed)?;
                contexts.registry = proposed;
            }
            let digest = journal::digest(&self.configuration.instructions);
            if binding.instructions_digest.as_deref() != Some(&digest) {
                let boundary = history::capture(&history_file)?;
                let applied = native
                    .control(
                        "instructions",
                        &json!({"text":self.configuration.instructions,"digest":digest}),
                        cancellation.clone(),
                    )
                    .await?;
                state::verify_instructions(
                    &history_file,
                    &digest,
                    &self.configuration.instructions,
                    boundary.as_ref(),
                    applied
                        .get("entryId")
                        .and_then(Value::as_str)
                        .ok_or_else(|| invalid("Pi did not expose its instruction receipt"))?,
                )?;
                let mut contexts = self
                    .contexts
                    .lock()
                    .map_err(|_| invalid("Pi registry ownership failed"))?;
                let mut proposed = contexts.registry.clone();
                proposed
                    .bindings
                    .iter_mut()
                    .find(|value| value.context == context)
                    .ok_or_else(|| invalid("Pi binding disappeared"))?
                    .instructions_digest = Some(digest);
                state::save(&self.configuration.home, &proposed)?;
                contexts.registry = proposed;
            }
            events.selected(id, selected.settings)?;
            events.observer.initialize_usage(
                &native
                    .request("get_session_stats", &json!({}), cancellation.clone())
                    .await?,
            )?;
            let connection = Arc::new(PiConnection::open(
                Arc::clone(&native),
                connection::Configuration {
                    session: id.to_owned(),
                    workspace: self.configuration.workspace.clone(),
                    history: history_file,
                    receipt: Self::receipt_path(&self.configuration.home, context),
                    hooks,
                },
            )?);
            events.bind_connection(&connection)?;
            clock::check(&cancellation)?;
            events.observer.state(State::Idle, None)?;
            Ok(Opened {
                connection,
                events: Arc::clone(&events),
            })
        }
        .await;
        if operation.is_err() {
            native.close().await?;
            events.close().await?;
        }
        let opened = operation?;
        let lifetime = self.lifetime();
        let native_lifetime = native.lifetime();
        let monitor = tokio::spawn(async move {
            tokio::select! { biased; _ = lifetime.cancelled() => {}, _ = native_lifetime.cancelled() => lifetime.cancel() }
        });
        self.contexts
            .lock()
            .map_err(|_| invalid("Pi history ownership failed"))?
            .monitors
            .push(monitor);
        Ok(opened)
    }
    pub fn contexts(&self) -> Result<Vec<String>> {
        Ok(self
            .contexts
            .lock()
            .map_err(|_| invalid("Pi history ownership failed"))?
            .registry
            .bindings
            .iter()
            .map(|binding| binding.context.clone())
            .collect())
    }
    fn unacknowledged(&self, context: &str) -> Result<bool> {
        let session = self
            .contexts
            .lock()
            .map_err(|_| invalid("Pi history ownership failed"))?
            .registry
            .bindings
            .iter()
            .find(|binding| binding.context == context)
            .and_then(|binding| binding.session_id.clone());
        let Some(session) = session else {
            return Ok(false);
        };
        let journal = journal::read::<Input>(
            &Self::receipt_path(&self.configuration.home, context),
            &session,
        )?;
        Ok(journal.pending.is_some() || !journal.confirmed.is_empty())
    }
    pub async fn activity(&self) -> Result<NativeActivity> {
        clock::check(&self.lifetime())?;
        let before = self.contexts()?;
        let mut activity = Vec::new();
        for context in &before {
            let (slot, session_id) = {
                let current = self
                    .contexts
                    .lock()
                    .map_err(|_| invalid("Pi history ownership failed"))?;
                (
                    current.slots.get(context).cloned(),
                    current
                        .registry
                        .bindings
                        .iter()
                        .find(|value| value.context == *context)
                        .and_then(|value| value.session_id.clone()),
                )
            };
            if slot
                .as_ref()
                .is_some_and(|value| value.opening.try_lock().is_err())
            {
                return Ok(NativeActivity {
                    busy: true,
                    contexts: Vec::new(),
                });
            }
            let Some(session_id) = session_id else {
                return Err(invalid("Pi activity has no exact native history"));
            };
            let busy = match slot.as_ref().and_then(|value| value.opened.get()) {
                Some(opened) => {
                    opened.connection.unsettled()? || opened.connection.inspect().await?
                }
                None => self.unacknowledged(context)?,
            };
            activity.push(NativeContextActivity {
                context: context.clone(),
                session_id,
                busy,
            });
        }
        let opening = self
            .contexts
            .lock()
            .map_err(|_| invalid("Pi history ownership failed"))?
            .slots
            .values()
            .any(|slot| slot.opening.try_lock().is_err());
        if opening || before != self.contexts()? {
            return Ok(NativeActivity {
                busy: true,
                contexts: Vec::new(),
            });
        }
        for item in &mut activity {
            item.busy |= match self.existing(&item.context)? {
                Some(connection) => connection.unsettled()?,
                None => self.unacknowledged(&item.context)?,
            };
        }
        Ok(NativeActivity {
            busy: self.configuration.hooks.pending_decisions()
                || activity.iter().any(|item| item.busy),
            contexts: activity,
        })
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
    pub async fn close(&self) -> Result<()> {
        self.cancellation.cancel();
        let slots = self
            .contexts
            .lock()
            .map_err(|_| invalid("Pi history ownership failed"))?
            .slots
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut failure = None;
        for slot in slots {
            let _opening = slot.opening.lock().await;
            if let Some(opened) = slot.opened.get() {
                if let Err(error) = opened.connection.close().await {
                    failure.get_or_insert(error);
                }
                if let Err(error) = opened.events.close().await {
                    failure.get_or_insert(error);
                }
            }
        }
        let monitors = std::mem::take(
            &mut self
                .contexts
                .lock()
                .map_err(|_| invalid("Pi history ownership failed"))?
                .monitors,
        );
        for monitor in monitors {
            if monitor.await.is_err() {
                failure.get_or_insert_with(|| invalid("Pi lifetime monitor failed during cleanup"));
            }
        }
        failure.map_or(Ok(()), Err)
    }
}
