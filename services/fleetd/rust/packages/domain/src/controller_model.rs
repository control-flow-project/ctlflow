use crate::model::{Configuration, Instance, Registration};
use crossfire_agent_core::{
    owned_runtime::{Attachment, SavedContext},
    runtime::SessionState,
    synchronization::CancellationToken,
};
use crossfire_kernel::Result;
use std::{collections::BTreeMap, future::Future, path::PathBuf, pin::Pin};

pub type Response<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControllerIdentity {
    pub name: String,
    pub metadata: Option<BTreeMap<String, String>>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    Daemon,
    Fleet(String),
    Agent { fleet: String, instance: String },
}
impl Target {
    pub fn fleet(&self) -> Option<&str> {
        match self {
            Self::Daemon => None,
            Self::Fleet(fleet) | Self::Agent { fleet, .. } => Some(fleet),
        }
    }
    pub fn instance(&self) -> Option<&str> {
        match self {
            Self::Agent { instance, .. } => Some(instance),
            _ => None,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Enroll,
    Start,
    Stop,
    Reset,
    Update,
}
impl Action {
    pub fn code(self) -> &'static str {
        match self {
            Self::Enroll => "enroll",
            Self::Start => "start",
            Self::Stop => "stop",
            Self::Reset => "reset",
            Self::Update => "update",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationRequest {
    pub id: String,
    pub target: Target,
    pub action: Action,
    pub expected_revision: i64,
    pub release_directory: Option<PathBuf>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalLink {
    pub url: String,
    pub code: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OperationError {
    pub instance: Option<String>,
    pub code: String,
    pub message: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationStatus {
    Accepted,
    Running,
    AwaitingApproval,
    Succeeded,
    Failed,
}
impl OperationStatus {
    pub fn code(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Running => "running",
            Self::AwaitingApproval => "awaiting-approval",
            Self::Succeeded => "succeeded",
            Self::Failed => "failed",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Operation {
    pub request: OperationRequest,
    pub status: OperationStatus,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub approval: Option<ApprovalLink>,
    pub errors: Vec<OperationError>,
    pub receipt_pending: bool,
}
#[derive(Debug, Clone)]
pub struct ConnectionState {
    pub connected: bool,
    pub delivery_enabled: bool,
    pub revision: Option<i64>,
    pub error: Option<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstancePhase {
    Stopped,
    Stopping,
    AwaitingApproval,
    Starting,
    Failed,
    Waking,
    Running,
    Sleeping,
}
impl InstancePhase {
    pub fn code(self) -> &'static str {
        match self {
            Self::Stopped => "stopped",
            Self::Stopping => "stopping",
            Self::AwaitingApproval => "awaiting-approval",
            Self::Starting => "starting",
            Self::Failed => "failed",
            Self::Waking => "waking",
            Self::Running => "running",
            Self::Sleeping => "sleeping",
        }
    }
}
#[derive(Debug, Clone)]
pub struct InstanceState {
    pub instance: Instance,
    pub phase: InstancePhase,
    pub session_id: Option<String>,
    pub error: Option<String>,
    pub started_at: Option<i64>,
    pub listener_active: bool,
    pub desired_active: bool,
    pub last_activity_at: Option<i64>,
    pub history_available: Option<bool>,
}
impl InstanceState {
    pub fn stopped(instance: Instance) -> Self {
        Self {
            instance,
            phase: InstancePhase::Stopped,
            session_id: None,
            error: None,
            started_at: None,
            listener_active: false,
            desired_active: false,
            last_activity_at: None,
            history_available: None,
        }
    }
}
#[derive(Debug, Clone)]
pub struct FleetState {
    pub registration: Registration,
    pub controller: ControllerIdentity,
    pub phase: InstancePhase,
    pub resume_instance_keys: Option<Vec<String>>,
    pub connection: ConnectionState,
    pub instances: Vec<InstanceState>,
    pub error: Option<String>,
}
#[derive(Debug, Clone)]
pub struct SetupDescriptor {
    pub server: String,
    pub owner: String,
    pub package_version: String,
    pub instructions: String,
}
#[derive(Debug, Clone)]
pub struct SetupRequest {
    pub descriptor: SetupDescriptor,
    pub workspace: PathBuf,
    pub configuration: Option<PathBuf>,
}
#[derive(Debug, Clone)]
pub struct SetupConfiguration {
    pub configuration: Configuration,
    pub operation_id: String,
    pub completed: bool,
}
#[derive(Debug, Clone)]
pub struct SetupOutcome {
    pub fleet: FleetState,
    pub operation: Option<Operation>,
    pub status: String,
}

pub trait RunningAgent: Send + Sync {
    fn diagnostics(
        &self,
        cancellation: CancellationToken,
    ) -> Response<'_, crossfire_agent_core::owned_runtime::NativeDiagnostic>;
    fn session_id(&self) -> &str;
    fn lifetime(&self) -> CancellationToken;
    fn deliberately_stopped(&self) -> bool;
    fn listener_active(&self) -> Result<bool>;
    fn native_state(&self) -> Result<SessionState>;
    fn resume(&self) -> Response<'_, ()>;
    fn attachment(&self, context: Option<&str>) -> Response<'_, Attachment>;
    fn contexts(&self) -> Response<'_, Vec<SavedContext>>;
    fn close(&self) -> Response<'_, ()>;
}
pub trait RemoteOperations: Send + Sync {
    fn target(&self, directory: &std::path::Path, instance: Option<&str>) -> Result<Target>;
    fn execute(
        self: std::sync::Arc<Self>,
        request: OperationRequest,
    ) -> Response<'static, Operation>;
    fn acknowledged(&self, id: &str) -> Result<()>;
}
