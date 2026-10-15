use crate::{enrollment, fleet_reports::Reports, native::Adapter, remote::Remote};
use crossfire_adapter_crossfire::Connection as Client;
use crossfire_adapter_crossfire::{fleet_connection::Fleet, listener_host::Host as ListenerHost};
use crossfire_adapter_filesystem::{
    absolute_state::AbsoluteState, agent_projects, lock::StateLock,
};
use crossfire_adapter_matrix::agent::Client as MatrixClient;
use crossfire_agent_core::{
    coordination::Coordination,
    listener_hooks::ListenerHooks,
    owned_runtime::{Inspection, OwnedAdapter, SavedContext},
};
use crossfire_contracts::{call::Call, operations::OperationId};
use crossfire_domain::runtime::values::Runtime;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use fleetd_domain::{controller_model::*, controller_ports::Execution, model::*};
use fleetd_storage::binding;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

pub type Clock = fn() -> Result<i64>;
pub type AgentHooks = ListenerHooks<AbsoluteState, Client, MatrixClient, Clock>;
pub type Connection = Fleet<Client, Remote>;
pub type FleetReports = Reports<AbsoluteState, Client>;
pub(crate) struct BoundFleet {
    pub control: Arc<Connection>,
    pub reports: Arc<FleetReports>,
    pub stop: CancellationToken,
}
pub struct Host {
    pub(crate) adapters: BTreeMap<String, Arc<Adapter>>,
    pub(crate) artifacts: PathBuf,
    pub(crate) storage: Arc<AbsoluteState>,
    pub(crate) log: Arc<dyn Fn(&str) + Send + Sync>,
    pub(crate) clock: Clock,
    connections: Mutex<BTreeMap<PathBuf, Arc<BoundFleet>>>,
    listener: AsyncMutex<Option<Arc<ListenerHost<AbsoluteState>>>>,
}
pub fn now() -> Result<i64> {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| unavailable("System clock precedes the epoch"))?;
    i64::try_from(time.as_millis())
        .map_err(|_| unavailable("System clock exceeds the timestamp range"))
}
pub(crate) fn unavailable(message: &str) -> Failure {
    Failure::new(ErrorCode::Unavailable, message)
}
pub(crate) fn text(path: &Path) -> Result<&str> {
    path.to_str()
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Native paths must be valid Unicode"))
}
impl Host {
    pub fn new(
        adapters: BTreeMap<String, Arc<Adapter>>,
        artifacts: PathBuf,
        log: Arc<dyn Fn(&str) + Send + Sync>,
        clock: Clock,
    ) -> Result<Self> {
        if !artifacts.is_absolute() || adapters.keys().any(|key| Runtime::parse(key).is_err()) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Execution requires explicit native adapters and an absolute approved release",
            ));
        }
        Ok(Self {
            adapters,
            artifacts,
            storage: Arc::new(AbsoluteState),
            log,
            clock,
            connections: Mutex::new(BTreeMap::new()),
            listener: AsyncMutex::new(None),
        })
    }
    pub(crate) fn client(
        &self,
        origin: &str,
        credential: Option<Secret>,
        stop: CancellationToken,
    ) -> Result<Client> {
        Client::new(origin, credential, stop)
    }
    pub(crate) fn find(&self, configuration: &Configuration) -> Result<Arc<BoundFleet>> {
        self.connections
            .lock()
            .map_err(|_| unavailable("Fleet connection ownership failed"))?
            .get(&configuration.directory)
            .cloned()
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Conflict,
                    "The enrolled fleet connection is not initialized",
                )
            })
    }
    pub(crate) fn adapter(&self, runtime: Runtime) -> Result<Arc<Adapter>> {
        self.adapters
            .get(runtime.code())
            .cloned()
            .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Unsupported native runtime"))
    }
    pub(crate) fn inspection(
        configuration: &Configuration,
        instance: &Instance,
    ) -> Result<Inspection> {
        let state = configuration.directory.join(&instance.workarea);
        Ok(Inspection {
            workspace: instance.workspace.clone().unwrap_or_else(|| state.clone()),
            state_directory: state,
            options: Value::Object(configuration.native_options(instance)?),
        })
    }
    pub(crate) async fn listener(&self) -> Result<Arc<ListenerHost<AbsoluteState>>> {
        let mut listener = self.listener.lock().await;
        if let Some(listener) = listener.as_ref() {
            return Ok(listener.clone());
        }
        let host = Arc::new(ListenerHost::open(self.storage.clone()).await?);
        *listener = Some(host.clone());
        Ok(host)
    }
    pub async fn close(&self) -> Result<()> {
        let connections = self
            .connections
            .lock()
            .map_err(|_| unavailable("Fleet connection ownership failed"))?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut failure = None;
        for connection in connections {
            if let Err(error) = connection.reports.close().await {
                failure.get_or_insert(error);
            }
            if let Err(error) = connection.control.close().await {
                failure.get_or_insert(error);
            }
            connection.stop.cancel();
        }
        if let Some(listener) = self.listener.lock().await.as_ref()
            && let Err(error) = listener.close().await
        {
            failure.get_or_insert(error);
        }
        if let Some(error) = failure {
            return Err(error);
        }
        self.connections
            .lock()
            .map_err(|_| unavailable("Fleet connection ownership failed"))?
            .clear();
        Ok(())
    }
}
impl Execution for Host {
    fn validate(&self, configuration: &Configuration) -> Result<()> {
        for definition in configuration.definitions.values() {
            let adapter = self.adapter(definition.runtime)?;
            <Adapter as OwnedAdapter<AgentHooks>>::validate(
                &adapter,
                &Value::Object(definition.options.clone()),
            )?;
        }
        for instance in &configuration.roster.instances {
            let definition = configuration
                .definitions
                .get(&instance.definition)
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Invalid, "Unknown native role definition")
                })?;
            <Adapter as OwnedAdapter<AgentHooks>>::validate(
                self.adapter(definition.runtime)?.as_ref(),
                &Value::Object(configuration.native_options(instance)?),
            )?;
        }
        Ok(())
    }
    fn connect(
        &self,
        configuration: &Configuration,
        stop: CancellationToken,
        operations: Weak<dyn RemoteOperations>,
    ) -> Result<()> {
        let saved = binding::load(&binding::open(configuration)?, configuration)?;
        let (Some(fleet), Some(credential)) = (&saved.fleet_id, &saved.controller_credential)
        else {
            return Ok(());
        };
        if saved.server != configuration.roster.coordination.server
            || saved.owner != configuration.roster.coordination.owner
            || saved.fleet_key != configuration.roster.fleet
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Fleet binding differs from its configured authority",
            ));
        }
        let mut connections = self
            .connections
            .lock()
            .map_err(|_| unavailable("Fleet connection ownership failed"))?;
        if connections.contains_key(&configuration.directory) {
            return Ok(());
        }
        let stop = stop.child_token();
        let client =
            Arc::new(self.client(&saved.server, Some(credential.clone()), stop.clone())?);
        let control = Fleet::open(
            client.clone(),
            fleet,
            credential.clone(),
            &saved.owner,
            Arc::new(Remote {
                directory: configuration.directory.clone(),
                binding: saved.clone(),
                operations,
            }),
            stop.clone(),
        )?;
        let reports = Reports::open(
            self.storage.clone(),
            client,
            fleet,
            text(&configuration.directory.join(".fleet/failures.json"))?,
            stop.clone(),
        )?;
        let value = Arc::new(BoundFleet {
            control,
            reports,
            stop,
        });
        connections.insert(configuration.directory.clone(), value.clone());
        let log = self.log.clone();
        tokio::spawn(async move {
            let result = async {
                value.control.start().await?;
                value.reports.start().await
            }
            .await;
            if let Err(error) = result {
                log(&error.message);
                value.stop.cancel();
            }
        });
        Ok(())
    }
    fn connection(&self, configuration: &Configuration) -> Result<ConnectionState> {
        let connections = self
            .connections
            .lock()
            .map_err(|_| unavailable("Fleet connection ownership failed"))?;
        let Some(connection) = connections.get(&configuration.directory) else {
            return Ok(ConnectionState {
                connected: false,
                delivery_enabled: false,
                revision: None,
                error: None,
            });
        };
        let status = connection.control.status()?;
        Ok(ConnectionState {
            connected: status.connected,
            delivery_enabled: status.delivery_enabled,
            revision: status.revision,
            error: status.error.or(connection.reports.error()?),
        })
    }
    async fn disconnect(&self, configuration: &Configuration) -> Result<()> {
        let connection = self
            .connections
            .lock()
            .map_err(|_| unavailable("Fleet connection ownership failed"))?
            .get(&configuration.directory)
            .cloned();
        let Some(connection) = connection else {
            return Ok(());
        };
        connection.control.close().await?;
        connection.reports.close().await?;
        connection.stop.cancel();
        self.connections
            .lock()
            .map_err(|_| unavailable("Fleet connection ownership failed"))?
            .remove(&configuration.directory);
        Ok(())
    }
    async fn prepare(
        &self,
        configuration: &Configuration,
        controller: &ControllerIdentity,
        enroll: bool,
        approval: Arc<dyn Fn(ApprovalLink) -> Result<()> + Send + Sync>,
        stop: CancellationToken,
    ) -> Result<()> {
        self.inspect(configuration, &configuration.roster.instances, stop.clone())
            .await?;
        crate::project_files::protect(
            &configuration.directory,
            &[".fleet/", "**/workarea/"],
            stop.clone(),
        )
        .await?;
        enrollment::prepare(
            configuration,
            &binding::open(configuration)?,
            controller,
            enroll,
            |credential| {
                self.client(
                    &configuration.roster.coordination.server,
                    credential,
                    stop.clone(),
                )
            },
            approval,
            stop.clone(),
        )
        .await
    }
    async fn inspect(
        &self,
        configuration: &Configuration,
        instances: &[Instance],
        stop: CancellationToken,
    ) -> Result<()> {
        self.validate(configuration)?;
        for instance in instances {
            crossfire_adapter_filesystem::PrivateDirectory::open(
                &configuration.directory.join(&instance.workarea),
                true,
            )?;
            let definition = &configuration.definitions[&instance.definition];
            <Adapter as OwnedAdapter<AgentHooks>>::inspect(
                self.adapter(definition.runtime)?.as_ref(),
                &Self::inspection(configuration, instance)?,
                stop.clone(),
            )
            .await?;
        }
        Ok(())
    }
    async fn contexts(
        &self,
        configuration: &Configuration,
        instance: &Instance,
    ) -> Result<Vec<SavedContext>> {
        let state = configuration.directory.join(&instance.workarea);
        match std::fs::symlink_metadata(&state) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
            Err(_) => {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Cannot inspect native work area",
                ));
            }
            Ok(_) => {}
        }
        <Adapter as OwnedAdapter<AgentHooks>>::saved_contexts(
            self.adapter(configuration.definitions[&instance.definition].runtime)?
                .as_ref(),
            &Self::inspection(configuration, instance)?,
        )
        .await
    }
    async fn start(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        recovery: bool,
        stop: CancellationToken,
    ) -> Result<Arc<dyn RunningAgent>> {
        self.start_instance(configuration, instance, recovery, stop)
            .await
    }
    async fn confirm_stopped(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        stop: CancellationToken,
    ) -> Result<()> {
        let saved = binding::load(&binding::open(configuration)?, configuration)?;
        if let Some(identity) = saved
            .identities
            .iter()
            .find(|identity| identity.instance_key == instance.key)
        {
            self.find(configuration)?
                .reports
                .confirm(&identity.agent_id, stop)
                .await?;
        }
        Ok(())
    }
    async fn delivery(
        &self,
        configuration: &Configuration,
        revision: i64,
        enabled: bool,
        stop: CancellationToken,
    ) -> Result<Value> {
        self.find(configuration)?
            .control
            .delivery(revision, enabled, stop)
            .await
    }
    async fn message(
        &self,
        configuration: &Configuration,
        id: &str,
        body: &str,
        stop: CancellationToken,
    ) -> Result<Value> {
        self.find(configuration)?
            .control
            .message(id, body, stop)
            .await
    }
    async fn test(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        stop: CancellationToken,
    ) -> Result<()> {
        self.test_instance(configuration, instance, stop).await
    }
    async fn reset(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        id: &str,
        stop: CancellationToken,
    ) -> Result<()> {
        self.reset_instance(configuration, instance, id, stop).await
    }
    async fn update(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        directory: &Path,
        stop: CancellationToken,
    ) -> Result<()> {
        if stop.is_cancelled() {
            return Err(unavailable("Software update was cancelled"));
        }
        let paths = agent_projects::paths(
            &configuration.directory.join(&instance.workarea),
            &instance.key,
        )?;
        let _listener = StateLock::acquire(&paths.state.join("listener"))?;
        let _receiver = StateLock::acquire(&paths.state.join("receiver"))?;
        crossfire_adapter_crossfire::agent_software::install(&paths.root, directory)?
            .activate(&paths.root)
    }
    async fn remove(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        stop: CancellationToken,
    ) -> Result<()> {
        let storage = binding::open(configuration)?;
        let mut saved = binding::load(&storage, configuration)?;
        let Some(identity) = saved
            .identities
            .iter()
            .find(|identity| identity.instance_key == instance.key)
            .cloned()
        else {
            return Ok(());
        };
        self.confirm_stopped(configuration, instance, stop.clone())
            .await?;
        let client = self.client(
            &saved.server,
            saved.controller_credential.clone(),
            stop.clone(),
        )?;
        let fleet = saved
            .fleet_id
            .as_ref()
            .ok_or_else(|| unavailable("Missing enrolled fleet"))?;
        let mut current = Call::new(OperationId::Fleet);
        current
            .parameters
            .insert("fleetId".to_owned(), fleet.clone());
        let revision = client.call(&current, stop.clone()).await?["revision"].clone();
        current.operation = OperationId::RemoveFleetAgent;
        current
            .parameters
            .insert("agentId".to_owned(), identity.agent_id.clone());
        current.body = Some(json!({"expectedRevision":revision,"instanceKey":instance.key}));
        client.call(&current, stop).await?;
        self.find(configuration)?
            .reports
            .forget(&identity.agent_id)?;
        saved.request = None;
        binding::save(&storage, &saved)
    }
    async fn archive(&self, configuration: &Configuration, stop: CancellationToken) -> Result<()> {
        for instance in &configuration.roster.instances {
            self.confirm_stopped(configuration, instance, stop.clone())
                .await?;
        }
        let saved = binding::load(&binding::open(configuration)?, configuration)?;
        let Some(fleet) = &saved.fleet_id else {
            return Ok(());
        };
        let client = self.client(
            &saved.server,
            saved.controller_credential.clone(),
            stop.clone(),
        )?;
        let mut call = Call::new(OperationId::Fleet);
        call.parameters.insert("fleetId".to_owned(), fleet.clone());
        let revision = client.call(&call, stop.clone()).await?["revision"].clone();
        call.operation = OperationId::ArchiveFleet;
        call.body = Some(json!({"expectedRevision":revision}));
        client.call(&call, stop).await.map(|_| ())
    }
}
