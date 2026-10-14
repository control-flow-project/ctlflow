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

pub trait OwnedConnection: Connection + TurnControl {
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
