mod actions;
mod operations;
mod recovery;
pub mod registry;
mod setup;
use crate::{
    controller_model::*,
    controller_ports::{Execution, Registry},
    model::*,
};
use crossfire_agent_core::{
    owned_runtime::{Attachment, SavedContext},
    runtime::Phase,
    synchronization::CancellationToken,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::Clock};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};
use tokio::sync::{Mutex as AsyncMutex, Semaphore, watch};

type Key = (String, String);
#[derive(Clone)]
struct Work {
    id: String,
    stop: CancellationToken,
    done: watch::Receiver<bool>,
}
impl Work {
    async fn wait(&self) -> Result<()> {
        let mut done = self.done.clone();
        while !*done.borrow_and_update() {
            done.changed()
                .await
                .map_err(|_| failed("Controller work ended without completing its cleanup"))?;
        }
        Ok(())
    }
}
struct State {
    records: Vec<Registration>,
    deployed: BTreeMap<String, Configuration>,
    instances: BTreeMap<Key, InstanceState>,
    running: BTreeMap<Key, Arc<dyn RunningAgent>>,
    wanted: BTreeSet<Key>,
    selections: BTreeMap<String, Vec<String>>,
    operations: BTreeMap<String, Work>,
    recovering: BTreeMap<Key, Work>,
    mutations: BTreeSet<String>,
    connection_errors: BTreeMap<std::path::PathBuf, String>,
    stopping: bool,
}
pub struct Controller<R, E, T> {
    registry: Arc<R>,
    execution: Arc<E>,
    clock: T,
    pub identity: ControllerIdentity,
    pub started_at: i64,
    state: Mutex<State>,
    lifetime: CancellationToken,
    recovery_starts: Semaphore,
    setup_owner: AsyncMutex<()>,
    close_owner: AsyncMutex<Option<Result<()>>>,
    restored: watch::Receiver<bool>,
    changed: watch::Sender<u64>,
}
fn failed(message: &str) -> Failure {
    Failure::new(ErrorCode::Unavailable, message)
}
fn conflict(message: &str) -> Failure {
    Failure::new(ErrorCode::Conflict, message)
}
fn missing(message: &str) -> Failure {
    Failure::new(ErrorCode::Missing, message)
}
impl<R: Registry + 'static, E: Execution + 'static, T: Clock + Clone + Send + Sync + 'static>
    Controller<R, E, T>
{
    pub fn open(
        registry: Arc<R>,
        execution: Arc<E>,
        identity: ControllerIdentity,
        clock: T,
    ) -> Result<Arc<Self>> {
        let records = registry.registrations()?;
        let wanted = registry.desired()?;
        let selections = registry.resume_selections()?;
        if wanted.iter().any(|value| {
            !records
                .iter()
                .any(|record| record.fleet_id == value.fleet_id)
        }) || selections.iter().any(|value| {
            !records
                .iter()
                .any(|record| record.fleet_id == value.fleet_id)
        }) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Saved desired bindings or resume selections reference an unregistered fleet",
            ));
        }
        let pending = registry.pending_operations()?;
        let (ready, restored) = watch::channel(false);
        let (changed, _) = watch::channel(0);
        let value = Arc::new(Self {
            registry,
            execution,
            started_at: clock.now()?,
            clock,
            identity,
            state: Mutex::new(State {
                records,
                deployed: BTreeMap::new(),
                instances: BTreeMap::new(),
                running: BTreeMap::new(),
                wanted: wanted
                    .into_iter()
                    .map(|value| (value.fleet_id, value.instance_key))
                    .collect(),
                selections: selections
                    .into_iter()
                    .map(|value| (value.fleet_id, value.instance_keys))
                    .collect(),
                operations: BTreeMap::new(),
                recovering: BTreeMap::new(),
                mutations: BTreeSet::new(),
                connection_errors: BTreeMap::new(),
                stopping: false,
            }),
            lifetime: CancellationToken::new(),
            recovery_starts: Semaphore::new(4),
            setup_owner: AsyncMutex::new(()),
            close_owner: AsyncMutex::new(None),
            restored,
            changed,
        });
        for mut operation in pending
            .into_iter()
            .filter(|operation| operation.completed_at.is_none())
        {
            if matches!(operation.request.action, Action::Stop | Action::Reset)
                && let Some(fleet) = operation.request.target.fleet()
            {
                let mut state = value.lock()?;
                let enabled = Self::enabled(&state, fleet, operation.request.target.instance());
                if operation.request.action == Action::Stop {
                    value.save_selection(
                        &mut state,
                        fleet,
                        &enabled,
                        operation.request.target.instance(),
                    )?;
                }
                value.intent(&mut state, fleet, &enabled, false)?;
            }
            operation.status = OperationStatus::Failed;
            operation.completed_at = Some(value.clock.now()?);
            operation.approval = None;
            operation.errors = vec![OperationError { instance: None, code: "unavailable".to_owned(), message: "Controller stopped before this operation completed; inspect and retry explicitly".to_owned() }];
            value.registry.save_operation(&operation)?;
        }
        let records = value.lock()?.records.clone();
        for record in records {
            match value.registry.load(&record.directory) {
                Ok(configuration) => value.connect(&configuration)?,
                Err(error) => {
                    value
                        .lock()?
                        .connection_errors
                        .insert(record.directory, error.message);
                }
            }
        }
        let controller = value.clone();
        tokio::spawn(async move {
            if let Err(error) = controller.restore().await
                && let Ok(mut state) = controller.lock()
            {
                for instance in state
                    .instances
                    .values_mut()
                    .filter(|instance| instance.phase == InstancePhase::Starting)
                {
                    instance.phase = InstancePhase::Failed;
                    instance.error = Some(error.message.clone());
                }
            }
            ready.send_replace(true);
        });
        Ok(value)
    }
    fn lock(&self) -> Result<MutexGuard<'_, State>> {
        self.state
            .lock()
            .map_err(|_| failed("Controller state ownership failed"))
    }
    fn signal(&self) {
        self.changed
            .send_modify(|revision| *revision = revision.wrapping_add(1));
    }
    pub fn stopping(&self) -> Result<bool> {
        Ok(self.lock()?.stopping)
    }
    pub async fn ready(&self) -> Result<()> {
        let mut restored = self.restored.clone();
        while !*restored.borrow_and_update() {
            restored
                .changed()
                .await
                .map_err(|_| failed("Controller restoration did not complete"))?;
        }
        Ok(())
    }
    fn enabled(state: &State, fleet: &str, instance: Option<&str>) -> Vec<String> {
        state
            .wanted
            .iter()
            .filter(|(selected, key)| {
                selected == fleet && instance.is_none_or(|instance| instance == key)
            })
            .map(|(_, key)| key.clone())
            .collect()
    }
    fn executing(state: &State, fleet: &str) -> bool {
        state.operations.contains_key(fleet)
            || state.running.keys().any(|(selected, _)| selected == fleet)
            || state.wanted.iter().any(|(selected, _)| selected == fleet)
    }
    fn inspect(&self, state: &State, fleet: &str) -> Result<(Registration, Configuration)> {
        let record = state
            .records
            .iter()
            .find(|record| record.fleet_id == fleet)
            .ok_or_else(|| missing("Fleet is not registered"))?
            .clone();
        let configuration = match state
            .deployed
            .get(fleet)
            .filter(|_| Self::executing(state, fleet))
        {
            Some(configuration) => configuration.clone(),
            None => self.registry.load(&record.directory)?,
        };
        if configuration.roster.fleet != record.fleet_key {
            return Err(conflict("A registered fleet key cannot change"));
        }
        Ok((record, configuration))
    }
    fn view_locked(&self, state: &State, fleet: &str) -> Result<FleetState> {
        let (record, configuration) = self.inspect(state, fleet)?;
        let instances = configuration
            .roster
            .instances
            .iter()
            .map(|instance| {
                let key = (fleet.to_owned(), instance.key.clone());
                let mut value = state
                    .instances
                    .get(&key)
                    .cloned()
                    .unwrap_or_else(|| InstanceState::stopped(instance.clone()));
                value.instance = instance.clone();
                value.desired_active = state.wanted.contains(&key);
                let runtime = state
                    .running
                    .get(&key)
                    .filter(|runtime| !runtime.lifetime().is_cancelled());
                value.listener_active = runtime
                    .map(|runtime| runtime.listener_active())
                    .transpose()?
                    .unwrap_or(false);
                if let Some(runtime) = runtime {
                    let native = runtime.native_state()?;
                    if value.phase == InstancePhase::Running {
                        value.phase = match native.phase {
                            Phase::Running => InstancePhase::Running,
                            Phase::Sleeping => InstancePhase::Sleeping,
                            Phase::Waking => InstancePhase::Waking,
                            Phase::Failed => InstancePhase::Failed,
                        };
                    }
                    value.last_activity_at = native.last_activity_at;
                    value.history_available = Some(native.history_available);
                }
                Ok(value)
            })
            .collect::<Result<Vec<_>>>()?;
        let phase = [
            InstancePhase::Stopping,
            InstancePhase::AwaitingApproval,
            InstancePhase::Starting,
            InstancePhase::Failed,
            InstancePhase::Waking,
            InstancePhase::Running,
            InstancePhase::Sleeping,
        ]
        .into_iter()
        .find(|phase| instances.iter().any(|instance| instance.phase == *phase))
        .unwrap_or(InstancePhase::Stopped);
        Ok(FleetState {
            controller: self.identity.clone(),
            phase,
            resume_instance_keys: state.selections.get(fleet).cloned(),
            connection: self.execution.connection(&configuration)?,
            instances,
            error: state.connection_errors.get(&record.directory).cloned(),
            registration: record,
        })
    }
    pub fn view(&self, fleet: &str) -> Result<FleetState> {
        self.view_locked(&*self.lock()?, fleet)
    }
    pub fn list(&self) -> Result<Vec<FleetState>> {
        let state = self.lock()?;
        let mut records = state.records.iter().collect::<Vec<_>>();
        records.sort_unstable_by_key(|record| &record.fleet_key);
        records
            .into_iter()
            .map(|record| match self.view_locked(&state, &record.fleet_id) {
                Ok(view) => Ok(view),
                Err(error) => Ok(FleetState {
                    registration: record.clone(),
                    controller: self.identity.clone(),
                    phase: InstancePhase::Failed,
                    resume_instance_keys: state.selections.get(&record.fleet_id).cloned(),
                    connection: ConnectionState {
                        connected: false,
                        delivery_enabled: false,
                        revision: None,
                        error: Some(error.message.clone()),
                    },
                    instances: vec![],
                    error: Some(error.message),
                }),
            })
            .collect()
    }
    fn connect(self: &Arc<Self>, configuration: &Configuration) -> Result<()> {
        let operations: Arc<dyn RemoteOperations> = self.clone();
        let result = self.execution.connect(
            configuration,
            self.lifetime.clone(),
            Arc::downgrade(&operations),
        );
        let mut state = self.lock()?;
        match result {
            Ok(()) => {
                state.connection_errors.remove(&configuration.directory);
            }
            Err(error) => {
                state
                    .connection_errors
                    .insert(configuration.directory.clone(), error.message);
            }
        }
        Ok(())
    }
    fn set_instance(
        &self,
        state: &mut State,
        fleet: &str,
        instance: &Instance,
        phase: InstancePhase,
        error: Option<String>,
    ) {
        let key = (fleet.to_owned(), instance.key.clone());
        let value = state
            .instances
            .entry(key.clone())
            .or_insert_with(|| InstanceState::stopped(instance.clone()));
        value.phase = phase;
        value.error = error;
        value.listener_active = false;
        value.desired_active = state.wanted.contains(&key);
        self.signal();
    }
    pub fn operation(&self, id: &str) -> Result<Operation> {
        self.registry
            .operation(id)?
            .ok_or_else(|| missing("Operation not found"))
    }
    pub fn acknowledge_operation(&self, id: &str) -> Result<()> {
        let _state = self.lock()?;
        let mut operation = self.operation(id)?;
        if operation.completed_at.is_none() {
            return Err(conflict(
                "Only completed native operations can release their receipt pin",
            ));
        }
        operation.receipt_pending = false;
        self.registry.save_operation(&operation)
    }
    pub fn maintain_history(&self, days: i64) -> Result<bool> {
        let age = days
            .checked_mul(86400000)
            .filter(|_| days > 0)
            .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Invalid logging retention"))?;
        self.registry
            .prune_operations(self.clock.now()?.saturating_sub(age), 500)
    }
    pub async fn attachment(
        &self,
        fleet: &str,
        instance: &str,
        context: Option<&str>,
    ) -> Result<Attachment> {
        let runtime = {
            let state = self.lock()?;
            if state.stopping {
                return Err(conflict("Controller is stopping"));
            }
            state.running.get(&(fleet.to_owned(), instance.to_owned())).filter(|runtime| !runtime.lifetime().is_cancelled()).cloned()
                .ok_or_else(|| conflict("Resume this agent before attaching its terminal; reading a pointer never starts a session"))?
        };
        runtime.attachment(context).await
    }
    pub async fn contexts(&self, fleet: &str, key: &str) -> Result<Vec<SavedContext>> {
        let (configuration, instance, runtime) = {
            let state = self.lock()?;
            let (_, configuration) = self.inspect(&state, fleet)?;
            let instance = configuration
                .roster
                .instances
                .iter()
                .find(|instance| instance.key == key)
                .ok_or_else(|| missing("Instance not found"))?
                .clone();
            let runtime = state
                .running
                .get(&(fleet.to_owned(), key.to_owned()))
                .filter(|runtime| !runtime.lifetime().is_cancelled())
                .cloned();
            (configuration, instance, runtime)
        };
        match runtime {
            Some(runtime) => runtime.contexts().await,
            None => self.execution.contexts(&configuration, &instance).await,
        }
    }
    pub async fn test(&self, fleet: &str, stop: CancellationToken) -> Result<()> {
        let (view, configuration) = {
            let state = self.lock()?;
            (
                self.view_locked(&state, fleet)?,
                self.inspect(&state, fleet)?.1,
            )
        };
        if self.stopping()?
            || !view.connection.connected
            || !view.connection.delivery_enabled
            || view.error.is_some()
        {
            return Err(conflict("Controller delivery is not ready"));
        }
        let instances = view
            .instances
            .into_iter()
            .filter(|instance| instance.desired_active)
            .collect::<Vec<_>>();
        if instances.is_empty() {
            return Err(conflict(
                "This fleet is stopped; reading readiness never starts sessions",
            ));
        }
        for instance in instances {
            if !instance.listener_active
                || instance.session_id.is_none()
                || !matches!(
                    instance.phase,
                    InstancePhase::Running | InstancePhase::Sleeping
                )
                || instance.error.is_some()
            {
                return Err(conflict(&format!(
                    "Instance {} has no ready listener/native binding",
                    instance.instance.key
                )));
            }
            self.execution
                .test(&configuration, &instance.instance, stop.clone())
                .await
                .map_err(|error| error.field(&instance.instance.key))?;
        }
        Ok(())
    }
    pub async fn delivery(
        &self,
        fleet: &str,
        revision: i64,
        enabled: bool,
        stop: CancellationToken,
    ) -> Result<Value> {
        let configuration = {
            let state = self.lock()?;
            if state.stopping {
                return Err(failed("Controller is stopping"));
            }
            self.inspect(&state, fleet)?.1
        };
        self.execution
            .delivery(&configuration, revision, enabled, stop)
            .await
    }
    pub async fn message(
        &self,
        fleet: &str,
        id: &str,
        body: &str,
        stop: CancellationToken,
    ) -> Result<Value> {
        let configuration = {
            let state = self.lock()?;
            if state.stopping {
                return Err(failed("Controller is stopping"));
            }
            self.inspect(&state, fleet)?.1
        };
        self.execution.message(&configuration, id, body, stop).await
    }
    async fn delay(&self, duration: Duration, stop: &CancellationToken) -> bool {
        tokio::select! { biased; _ = stop.cancelled() => false, _ = tokio::time::sleep(duration) => true }
    }
}
impl<R: Registry + 'static, E: Execution + 'static, T: Clock + Clone + Send + Sync + 'static>
    RemoteOperations for Controller<R, E, T>
{
    fn target(&self, directory: &std::path::Path, instance: Option<&str>) -> Result<Target> {
        let state = self.lock()?;
        let fleet = state
            .records
            .iter()
            .find(|record| record.directory == directory)
            .ok_or_else(|| missing("Remote operation has no registered fleet directory"))?;
        Ok(match instance {
            Some(instance) => Target::Agent {
                fleet: fleet.fleet_id.clone(),
                instance: instance.to_owned(),
            },
            None => Target::Fleet(fleet.fleet_id.clone()),
        })
    }
    fn execute(self: Arc<Self>, request: OperationRequest) -> Response<'static, Operation> {
        Box::pin(async move { self.execute_remote(request).await })
    }
    fn acknowledged(&self, id: &str) -> Result<()> {
        self.acknowledge_operation(id)
    }
}
