use crate::runtime::{Approval, Connection, Hooks, TurnControl};
use crossfire_domain::runtime::values::{HistoryMode, Setting};
use crossfire_kernel::Result;
use serde_json::Value;
use std::{collections::BTreeMap, future::Future, path::PathBuf, sync::Arc};
use tokio_util::sync::CancellationToken;

pub type RuntimeOptions = serde_json::Map<String, Value>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SavedContext {
    pub context: String,
    pub runtime: String,
    pub session_id: String,
    pub workspace: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attachment {
    pub runtime: String,
    pub session_id: String,
    pub workspace: PathBuf,
    pub connection: BTreeMap<String, String>,
}

pub struct Input<H> {
    pub profile: String,
    pub name: String,
    pub workspace: PathBuf,
    pub state_directory: PathBuf,
    pub instructions: String,
    pub options: Value,
    pub hooks: Arc<H>,
    pub history_mode: HistoryMode,
    pub allow_new_history: bool,
}

impl<H> Clone for Input<H> {
    fn clone(&self) -> Self {
        Self {
            profile: self.profile.clone(),
            name: self.name.clone(),
            workspace: self.workspace.clone(),
            state_directory: self.state_directory.clone(),
            instructions: self.instructions.clone(),
            options: self.options.clone(),
            hooks: self.hooks.clone(),
            history_mode: self.history_mode,
            allow_new_history: self.allow_new_history,
        }
    }
}

pub struct Inspection {
    pub workspace: PathBuf,
    pub state_directory: PathBuf,
    pub options: Value,
}
pub struct Validation {
    pub options: Value,
    pub approval: Approval,
}
pub struct Reset {
    pub workspace: PathBuf,
    pub state_directory: PathBuf,
    pub reset_id: String,
}

pub struct NativeContextActivity {
    pub context: String,
    pub session_id: String,
    pub busy: bool,
}
pub struct NativeActivity {
    pub busy: bool,
    pub contexts: Vec<NativeContextActivity>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderState {
    Present,
    Missing,
    NotRequired,
    Unknown,
}
#[derive(Debug, Clone)]
pub struct NativeDiagnostic {
    pub checked_at: i64,
    pub state: String,
    pub observed_at: Option<i64>,
    pub provider: ProviderState,
    pub provider_observed_at: Option<i64>,
    pub pending_input: bool,
    pub pending_decision: bool,
}
pub trait OwnedConnection: Connection + TurnControl {
    fn provider(
        &self,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<ProviderState>> + Send;
    fn activity(&self) -> impl Future<Output = Result<NativeActivity>> + Send;
    fn attachment(&self) -> Option<Attachment>;
    fn attachments(&self) -> impl Future<Output = Result<Vec<(String, Attachment)>>> + Send;
}

pub trait OwnedAdapter<H: Hooks>: Send + Sync {
    type Connection: OwnedConnection;
    fn configured_settings(&self, options: &Value) -> Result<Vec<Setting>>;
    fn validate(&self, options: &Value) -> Result<Validation>;
    fn inspect(
        &self,
        input: &Inspection,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn saved_contexts(
        &self,
        input: &Inspection,
    ) -> impl Future<Output = Result<Vec<SavedContext>>> + Send;
    fn reset(&self, input: &Reset) -> impl Future<Output = Result<()>> + Send;
    fn start(
        &self,
        input: Input<H>,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<Self::Connection>> + Send;
}

pub trait Terminal: Send + Sync {
    fn command(&self, attachment: &Attachment) -> Result<String>;
}
