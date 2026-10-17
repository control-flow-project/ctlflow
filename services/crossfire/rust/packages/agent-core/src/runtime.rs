use crossfire_domain::{
    runtime::values::{Question, Runtime, Setting, State},
    statistics::Usage,
};
use crossfire_kernel::Result;
use serde_json::Value;
use std::future::Future;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Approval {
    None,
    Runtime,
    Listener,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputPriority {
    Steering,
}

pub struct Admission {
    pub priority: InputPriority,
    pub cancellation: CancellationToken,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Running,
    Sleeping,
    Waking,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionState {
    pub phase: Phase,
    pub last_activity_at: Option<i64>,
    pub history_available: bool,
}

pub struct Choice {
    pub label: String,
    pub value: Value,
}

pub struct Decision {
    pub runtime: Runtime,
    pub session_id: String,
    pub request_id: String,
    pub action: String,
    pub scope: Value,
    pub choices: Vec<Choice>,
    pub turn_id: Option<String>,
    pub item_id: Option<String>,
    pub blocking: Option<bool>,
    pub expires_ms: Option<i64>,
    pub questions: Option<Vec<Question>>,
}

pub enum ObservationEvent {
    Output {
        session_id: String,
        id: String,
        stream_id: Option<String>,
        text: String,
    },
    State {
        runtime: Runtime,
        session_id: String,
        room_id: Option<String>,
        state: State,
        observed_at: i64,
        settings: Vec<Setting>,
        error_message: Option<String>,
    },
}

pub trait Hooks: Send + Sync {
    fn request_decision(
        &self,
        decision: &Decision,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<Value>> + Send;
    fn decision_responded(&self, decision: &Decision);
    fn usage(&self, sample: &Usage);
    fn pending_decisions(&self) -> bool;
    fn pending_input(&self) -> bool;
    fn observe(&self, event: ObservationEvent);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InterruptResult {
    Interrupted,
    Inactive,
}

pub trait TurnControl: Send + Sync {
    fn active_turn(
        &self,
        room: Option<&str>,
        admission: Option<&Admission>,
    ) -> impl Future<Output = Result<Option<String>>> + Send;
    fn interrupt(
        &self,
        turn_id: &str,
        recovery: bool,
        admission: Option<&Admission>,
    ) -> impl Future<Output = Result<InterruptResult>> + Send;
}

pub trait Lifecycle: Send + Sync {
    fn current(&self) -> Result<SessionState>;
    fn configure_idle(&self, seconds: i64) -> Result<()>;
}

pub trait Connection: Send + Sync + Sized {
    fn session_id(&self) -> &str;
    fn approval(&self) -> Approval;
    fn lifetime(&self) -> CancellationToken;
    fn inspect(&self) -> impl Future<Output = Result<bool>> + Send;
    fn deliver(
        &self,
        text: &str,
        message_id: &str,
        cancellation: CancellationToken,
        priority: Option<InputPriority>,
    ) -> impl Future<Output = Result<()>> + Send;
    fn settle(&self, cancellation: CancellationToken) -> impl Future<Output = Result<bool>> + Send;
    fn recover(
        &self,
        text: &str,
        message_id: &str,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<bool>> + Send;
    fn acknowledge(&self, message_ids: &[String]) -> Result<()>;
    fn conversation(
        &self,
        room: &str,
        admission: Option<&Admission>,
    ) -> impl Future<Output = Result<Self>> + Send;
    fn close(&self) -> impl Future<Output = Result<()>> + Send;
}
