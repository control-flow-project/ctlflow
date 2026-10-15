use crate::{controller_model::*, model::*, resume_selection::SelectionStore};
use crossfire_agent_core::{owned_runtime::SavedContext, synchronization::CancellationToken};
use crossfire_kernel::Result;
use serde_json::Value;
use std::{
    future::Future,
    path::Path,
    sync::{Arc, Weak},
};

pub trait Registry: SelectionStore + Send + Sync {
    fn registrations(&self) -> Result<Vec<Registration>>;
    fn save_registrations(&self, values: &[Registration]) -> Result<()>;
    fn desired(&self) -> Result<Vec<DesiredIntent>>;
    fn save_desired(&self, values: &[DesiredIntent]) -> Result<()>;
    fn pending_operations(&self) -> Result<Vec<Operation>>;
    fn operation(&self, id: &str) -> Result<Option<Operation>>;
    fn save_operation(&self, value: &Operation) -> Result<()>;
    fn prune_operations(&self, cutoff: i64, maximum: usize) -> Result<bool>;
    fn load(&self, directory: &Path) -> Result<Configuration>;
    fn write_roster(&self, configuration: &Configuration, roster: &Roster)
    -> Result<Configuration>;
    fn setup(&self, request: &SetupRequest) -> Result<SetupConfiguration>;
    fn complete_setup(&self, id: &str) -> Result<()>;
    fn retry_setup(&self, previous: &str, next: &str) -> Result<()>;
}
pub trait Execution: Send + Sync {
    fn connect(
        &self,
        configuration: &Configuration,
        stop: CancellationToken,
        operations: Weak<dyn RemoteOperations>,
    ) -> Result<()>;
    fn connection(&self, configuration: &Configuration) -> Result<ConnectionState>;
    fn delivery(
        &self,
        configuration: &Configuration,
        revision: i64,
        enabled: bool,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<Value>> + Send;
    fn message(
        &self,
        configuration: &Configuration,
        id: &str,
        body: &str,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<Value>> + Send;
    fn disconnect(&self, configuration: &Configuration) -> impl Future<Output = Result<()>> + Send;
    fn validate(&self, configuration: &Configuration) -> Result<()>;
    fn inspect(
        &self,
        configuration: &Configuration,
        instances: &[Instance],
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn test(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn prepare(
        &self,
        configuration: &Configuration,
        controller: &ControllerIdentity,
        enroll: bool,
        approval: Arc<dyn Fn(ApprovalLink) -> Result<()> + Send + Sync>,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn start(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        recovery: bool,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<Arc<dyn RunningAgent>>> + Send;
    fn contexts(
        &self,
        configuration: &Configuration,
        instance: &Instance,
    ) -> impl Future<Output = Result<Vec<SavedContext>>> + Send;
    fn confirm_stopped(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn reset(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        id: &str,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn remove(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn archive(
        &self,
        configuration: &Configuration,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn update(
        &self,
        configuration: &Configuration,
        instance: &Instance,
        directory: &Path,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
}
