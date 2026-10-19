use crate::{
    host::{AgentHooks, BoundFleet, Clock, Host, text, unavailable},
    runtime_start::{NativeOwner, RuntimeStart, Template},
};
use crossfire_adapter_crossfire::{
    agent_software,
    fleet_connection::Acknowledger,
    listener_host::{self, Binding as HostBinding},
};
use crossfire_adapter_filesystem::{
    absolute_state::AbsoluteState, agent_projects, lock::StateLock,
};
use crossfire_agent_core::{
    coordination::Coordination,
    listener::{self, Factory, Options, Resources},
    listener_control::Control,
    listener_reporting::Reporter,
    local_state,
    owned_runtime::{Attachment, SavedContext},
    profile::{self, Profile, Settings},
    runtime::SessionState,
};
use crossfire_contracts::{call::Call, operations::OperationId};
use crossfire_domain::messaging_client::{MessagingClient, MessagingConnector};
use crossfire_domain::runtime::values::HistoryMode;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::{
    controller_model::{Response, RunningAgent},
    model::{Configuration, Instance},
    native_lifecycle::Initial,
};
use fleetd_storage::{binding, work::Work};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tokio::{
    sync::{Mutex as AsyncMutex, watch},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

type Startup<M> = RuntimeStart<AgentHooks<M>, Work, Clock>;
type RuntimeOwner<M> = NativeOwner<AgentHooks<M>, Work, Clock>;
type ActivityReporter = Reporter<crossfire_adapter_crossfire::Connection, Clock>;
struct Agent<M: MessagingClient + 'static> {
    session: String,
    native: Startup<M>,
    stop: CancellationToken,
    control: Arc<Control>,
    connection: Arc<BoundFleet>,
    id: String,
    reporter: Mutex<Option<Arc<ActivityReporter>>>,
    ownership: Mutex<Option<StateLock>>,
    binding: Mutex<Option<HostBinding<AbsoluteState>>>,
    task: AsyncMutex<Option<JoinHandle<Result<()>>>>,
    maintenance: AsyncMutex<Option<JoinHandle<Result<()>>>>,
    close_owner: AsyncMutex<()>,
    reported_closed: AtomicBool,
}
struct Start<M: MessagingClient + 'static> {
    inner: Startup<M>,
    reporter: Arc<Mutex<Option<Arc<ActivityReporter>>>>,
    initialization: Arc<crossfire_adapter_filesystem::local_state::State>,
    id: String,
}
impl<M: MessagingClient + 'static> Factory<AgentHooks<M>> for Start<M> {
    type Native = <Startup<M> as Factory<AgentHooks<M>>>::Native;
    async fn start(
        &self,
        hooks: Arc<AgentHooks<M>>,
        stop: CancellationToken,
    ) -> Result<Self::Native> {
        *self
            .reporter
            .lock()
            .map_err(|_| unavailable("Listener activity ownership failed"))? =
            Some(hooks.reporter.clone());
        let native = self.inner.start(hooks, stop).await?;
        if self.inner.template.allow_new_history {
            binding::initialized(self.initialization.as_ref(), &self.id)?;
        }
        Ok(native)
    }
}
impl<M: MessagingClient + 'static> Agent<M> {
    fn owner(&self) -> Result<Arc<RuntimeOwner<M>>> {
        self.native
            .owner()?
            .ok_or_else(|| unavailable("Native startup is not complete"))
    }
    async fn shutdown(&self) -> Result<()> {
        let _close = self.close_owner.lock().await;
        self.native.stop(true).await?;
        self.stop.cancel();
        let mut failure = None;
        for owner in [&self.task, &self.maintenance] {
            if let Some(task) = owner.lock().await.take() {
                match task.await {
                    Ok(Ok(())) => {}
                    Ok(Err(_)) => {}
                    Err(_) => {
                        failure.get_or_insert(unavailable(
                            "Owned listener task failed during shutdown",
                        ));
                    }
                }
            }
        }
        let closed = match self.native.owner()? {
            Some(owner) => owner.close().await,
            None => Ok(()),
        };
        closed?;
        let activity = self
            .reporter
            .lock()
            .map_err(|_| unavailable("Listener reporting ownership failed"))?
            .clone();
        if !self.reported_closed.load(Ordering::Acquire)
            && let Some(activity) = activity
                .and_then(|reporter| reporter.last_reported_activity().transpose())
                .transpose()?
        {
            let control = self.control.clone();
            self.connection.reports.closed(
                &self.id,
                activity,
                Arc::new(move || Ok(control.current()?.binding)),
            )?;
            self.reported_closed.store(true, Ordering::Release);
        }
        self.connection.control.unbind(&self.id)?;
        if let Some(binding) = self
            .binding
            .lock()
            .map_err(|_| unavailable("Listener host ownership failed"))?
            .as_ref()
        {
            binding.close()?;
        }
        self.binding
            .lock()
            .map_err(|_| unavailable("Listener host ownership failed"))?
            .take();
        self.ownership
            .lock()
            .map_err(|_| unavailable("Native listener ownership failed"))?
            .take();
        if let Some(error) = failure {
            return Err(error);
        }
        Ok(())
    }
}
impl<M: MessagingClient + 'static> RunningAgent for Agent<M> {
    fn diagnostics(
        &self,
        cancellation: CancellationToken,
    ) -> Response<'_, crossfire_agent_core::owned_runtime::NativeDiagnostic> {
        Box::pin(async move { self.owner()?.diagnostics(cancellation).await })
    }
    fn session_id(&self) -> &str {
        &self.session
    }
    fn lifetime(&self) -> CancellationToken {
        self.stop.clone()
    }
    fn deliberately_stopped(&self) -> bool {
        self.binding
            .lock()
            .ok()
            .and_then(|binding| {
                binding
                    .as_ref()
                    .map(|binding| binding.deliberately_stopped())
            })
            .unwrap_or(false)
    }
    fn listener_active(&self) -> Result<bool> {
        Ok(self.control.current()?.active)
    }
    fn native_state(&self) -> Result<SessionState> {
        self.native
            .state()?
            .ok_or_else(|| unavailable("Native session state is not initialized"))
    }
    fn resume(&self) -> Response<'_, ()> {
        Box::pin(async move { self.owner()?.resume().await })
    }
    fn attachment(&self, context: Option<&str>) -> Response<'_, Attachment> {
        let context = context.map(str::to_owned);
        Box::pin(async move { self.owner()?.attachment(context.as_deref()).await })
    }
    fn contexts(&self) -> Response<'_, Vec<SavedContext>> {
        Box::pin(async move { self.owner()?.contexts().await })
    }
    fn close(&self) -> Response<'_, ()> {
        Box::pin(self.shutdown())
    }
}
impl<C: MessagingConnector> Host<C> {
    pub(crate) async fn start_instance(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        recovery: bool,
        stop: CancellationToken,
    ) -> Result<Arc<dyn RunningAgent>> {
        let initialization = Arc::new(binding::open(configuration)?);
        let saved = binding::load(initialization.as_ref(), configuration)?;
        let identity = saved
            .identities
            .iter()
            .find(|identity| identity.instance_key == instance.key)
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Instance has no enrolled identity"))?
            .clone();
        let connection = self.find(configuration)?;
        let inspection = Self::inspection(configuration, instance)?;
        crossfire_adapter_filesystem::PrivateDirectory::open(&inspection.state_directory, true)?;
        crate::project_files::protect(&inspection.state_directory, &[".crossfire/"], stop.clone())
            .await?;
        let paths = agent_projects::paths(&inspection.state_directory, &instance.key)?;
        let ownership = StateLock::acquire(&paths.state.join("listener"))?;
        let software = if recovery
            || crossfire_adapter_filesystem::PrivateDirectory::open(&paths.root, false)?
                .managed_link("client.mjs")?
                .is_some()
        {
            agent_software::installed(&paths.root)?
        } else {
            agent_software::install(&paths.root, &self.artifacts)?
        };
        let client = Arc::new(self.client(
            &saved.server,
            Some(identity.account.access_token.clone()),
            stop.clone(),
        )?);
        let health = client
            .call(&Call::new(OperationId::Health), stop.clone())
            .await?;
        let profile = Profile {
            settings: Settings {
                instance: health["instance"]
                    .as_str()
                    .ok_or_else(|| unavailable("Crossfire did not identify its instance"))?
                    .to_owned(),
                server: saved.server.clone(),
                backend: crossfire_contracts::messaging::configuration(
                    &client
                        .call(&Call::new(OperationId::MessagingBackend), stop.clone())
                        .await?["configuration"],
                )?,
                owner: saved.owner.clone(),
                max_upload_bytes: 16777216,
            },
            workspace: inspection.state_directory.clone(),
            id: identity.agent_id.clone(),
            account: identity.account.clone(),
        };
        local_state::write(
            self.storage.as_ref(),
            text(&paths.profile)?,
            &profile::value(&profile)?,
            1048576,
        )?;
        software.activate(&paths.root)?;
        let definition = &configuration.definitions[&instance.definition];
        let adapter = self.adapter(definition.runtime)?;
        let allow_new_history =
            binding::can_initialize(initialization.as_ref(), &identity.agent_id)?;
        let host = self.listener().await?;
        let native = Startup::new(
            adapter,
            Template {
                profile: instance.key.clone(),
                name: instance.name.clone(),
                workspace: inspection.workspace,
                state_directory: inspection.state_directory,
                instructions: format!(
                    "{}\n\nCrossfire identity: {}. This instance is already enrolled and its listener is managed by fleetd. Do not reconnect, enroll or start another listener.\n\nUse the intentional Crossfire tools from CROSSFIRE_PROJECT: node \"$CROSSFIRE_PROJECT/.crossfire/client.mjs\" --profile {}. The profile is this instance's immutable local key, not its display name. Connection and telemetry require no model action. Never disclose host paths or private machine configuration outside the owner DM.\n\n{}\n\n{}",
                    definition.instructions,
                    instance.name,
                    instance.key,
                    crate::reset::instructions(self.storage.as_ref(), &paths.state)?,
                    software.skill
                ),
                options: inspection.options,
                history_mode: instance.history_mode.unwrap_or(HistoryMode::Shared),
                initial: if recovery && !allow_new_history {
                    Initial::ResumeSleeping
                } else {
                    Initial::Start
                },
                allow_new_history,
            },
            Arc::new(Work::open(&paths.state)?),
            self.clock,
            host.budget.clone(),
        )?;
        let stop = stop.child_token();
        let messaging = Arc::new(self.messaging.connect(
            &profile.settings.backend,
            &profile.account,
            profile.settings.max_upload_bytes,
            stop.clone(),
        )?);
        let control = connection.control.bind(&identity.agent_id)?;
        let binding = match host.bind(listener_host::Options {
            name: format!("fleet-{}", identity.agent_id),
            release: software.release.manifest.release.clone(),
            cursor: text(&paths.cursors)?.to_owned(),
            stop: stop.clone(),
        }) {
            Ok(binding) => binding,
            Err(error) => {
                connection.control.unbind(&identity.agent_id)?;
                return Err(error);
            }
        };
        let mut ready = binding.ready().subscribe();
        let reporter = Arc::new(Mutex::new(None));
        let factory = Start {
            inner: native.clone(),
            reporter: reporter.clone(),
            initialization,
            id: identity.agent_id.clone(),
        };
        let resource = Resources {
            storage: self.storage.clone(),
            coordination: client,
            messaging,
            acknowledgment: Arc::new(Acknowledger {
                fleet: connection.control.clone(),
                agent: identity.agent_id.clone(),
            }),
            control: control.clone(),
            budget: host.budget.clone(),
            clock: self.clock,
            ready: Some(binding.ready()),
            diagnostic: {
                let log = self.log.clone();
                Arc::new(move |error| {
                    log(&format!(
                        "Listener retry: {}: {}",
                        error.code.as_str(),
                        error.message
                    ))
                })
            },
        };
        let options = Options {
            profile,
            file: text(&paths.cursors)?.to_owned(),
            release: software.release.manifest.release,
            history_mode: instance.history_mode.unwrap_or(HistoryMode::Shared),
            room: None,
            limit: 100,
            poll_ms: 10000,
            debounce_ms: 0,
            reconcile_ms: 30000,
        };
        let run_stop = stop.clone();
        let (ended, mut observed_end) = watch::channel(None);
        let task = tokio::spawn(async move {
            let result = listener::run(resource, factory, options, run_stop).await;
            ended.send_replace(Some(result.clone()));
            result
        });
        let readiness = async {
            loop {
                if let Some(result) = observed_end.borrow().as_ref() {
                    return Err(result.as_ref().err().cloned().unwrap_or_else(|| {
                        unavailable("Listener stopped before it became ready")
                    }));
                }
                if let Some(endpoint) = ready.borrow().as_ref() {
                    return Ok(endpoint.session().to_owned());
                }
                tokio::select! { biased;
                    _=stop.cancelled()=>return Err(unavailable("Listener startup was cancelled")),
                    changed=ready.changed()=> { changed.map_err(|_| unavailable("Listener stopped before it became ready"))?; },
                    changed=observed_end.changed()=> { changed.map_err(|_| unavailable("Listener startup task ended"))?; },
                }
            }
        };
        let ready = tokio::time::timeout(Duration::from_secs(75), readiness)
            .await
            .unwrap_or_else(|_| {
                Err(unavailable(
                    "Listener readiness exceeded its startup deadline",
                ))
            });
        let agent = Arc::new(Agent {
            session: ready.as_ref().ok().cloned().unwrap_or_default(),
            native,
            stop: stop.clone(),
            control,
            connection: connection.clone(),
            id: identity.agent_id.clone(),
            reporter: Mutex::new(
                reporter
                    .lock()
                    .map_err(|_| unavailable("Listener activity ownership failed"))?
                    .clone(),
            ),
            ownership: Mutex::new(Some(ownership)),
            binding: Mutex::new(Some(binding)),
            task: AsyncMutex::new(Some(task)),
            maintenance: AsyncMutex::new(None),
            close_owner: AsyncMutex::new(()),
            reported_closed: AtomicBool::new(false),
        });
        if let Err(error) = ready {
            (self.log)(&error.message);
            connection
                .reports
                .failure(&identity.agent_id, None, &error)?;
            agent.shutdown().await?;
            return Err(error);
        }
        connection.reports.recovered(&identity.agent_id)?;
        let weak = Arc::downgrade(&agent);
        let log = self.log.clone();
        let monitor = tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(1));
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! { biased; _=stop.cancelled()=>return Ok(()), _=interval.tick()=>{} }
                let Some(agent) = weak.upgrade() else {
                    return Ok(());
                };
                let ended = agent
                    .task
                    .lock()
                    .await
                    .as_ref()
                    .is_none_or(|task| task.is_finished());
                let result = if ended {
                    Err(unavailable(
                        "Listener binding stopped; recovering the exact saved identity and history",
                    ))
                } else {
                    agent.native.maintain().await
                };
                if let Err(error) = result {
                    log(&error.message);
                    connection
                        .reports
                        .failure(&identity.agent_id, Some(&agent.session), &error)?;
                    agent.stop.cancel();
                    return Ok(());
                }
            }
        });
        *agent.maintenance.lock().await = Some(monitor);
        Ok(agent)
    }
    pub(crate) async fn test_instance(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        stop: CancellationToken,
    ) -> Result<()> {
        let paths = agent_projects::paths(
            &configuration.directory.join(&instance.workarea),
            &instance.key,
        )?;
        let value = crossfire_adapter_crossfire::listener_client::request(
            &paths.state,
            &serde_json::json!({"action":"test"}),
            stop,
        )
        .await?;
        if value["ready"] != true
            || value["test"]["session"] != value["session"]
            || value["test"]["server"].as_str()
                != Some(configuration.roster.coordination.server.as_str())
            || value["test"]["busy"] != false
            || value["test"]["deliveryPaused"] != false
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Listener authentication, exact saved session or idle delivery is not confirmed",
            ));
        }
        Ok(())
    }
}
