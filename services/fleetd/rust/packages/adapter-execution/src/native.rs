use crossfire_adapter_codex::owned::{CodexOwnedConnection, CodexRuntime};
use crossfire_adapter_pi::owned::{PiOwnedConnection, PiRuntime};
use crossfire_agent_core::{
    owned_runtime::{
        Attachment, Input, Inspection, NativeActivity, OwnedAdapter, OwnedConnection, Reset,
        SavedContext, Validation,
    },
    runtime::{
        Admission, Approval, Connection, Hooks, InputPriority, InterruptResult, TurnControl,
    },
};
use crossfire_domain::runtime::values::Setting;
use crossfire_kernel::Result;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

pub enum Adapter {
    Codex(CodexRuntime),
    Pi(PiRuntime),
}
pub enum Native<H> {
    Codex(CodexOwnedConnection<H>),
    Pi(PiOwnedConnection<H>),
}
impl<H: Hooks + 'static> OwnedAdapter<H> for Adapter {
    type Connection = Native<H>;
    fn configured_settings(&self, options: &Value) -> Result<Vec<Setting>> {
        match self {
            Self::Codex(adapter) => {
                <CodexRuntime as OwnedAdapter<H>>::configured_settings(adapter, options)
            }
            Self::Pi(adapter) => {
                <PiRuntime as OwnedAdapter<H>>::configured_settings(adapter, options)
            }
        }
    }
    fn validate(&self, options: &Value) -> Result<Validation> {
        match self {
            Self::Codex(adapter) => <CodexRuntime as OwnedAdapter<H>>::validate(adapter, options),
            Self::Pi(adapter) => <PiRuntime as OwnedAdapter<H>>::validate(adapter, options),
        }
    }
    async fn inspect(&self, input: &Inspection, stop: CancellationToken) -> Result<()> {
        match self {
            Self::Codex(adapter) => adapter.inspect(input, stop).await,
            Self::Pi(adapter) => adapter.inspect(input, stop).await,
        }
    }
    async fn saved_contexts(&self, input: &Inspection) -> Result<Vec<SavedContext>> {
        match self {
            Self::Codex(adapter) => {
                <CodexRuntime as OwnedAdapter<H>>::saved_contexts(adapter, input).await
            }
            Self::Pi(adapter) => {
                <PiRuntime as OwnedAdapter<H>>::saved_contexts(adapter, input).await
            }
        }
    }
    async fn reset(&self, input: &Reset) -> Result<()> {
        match self {
            Self::Codex(adapter) => <CodexRuntime as OwnedAdapter<H>>::reset(adapter, input).await,
            Self::Pi(adapter) => <PiRuntime as OwnedAdapter<H>>::reset(adapter, input).await,
        }
    }
    async fn start(&self, input: Input<H>, stop: CancellationToken) -> Result<Self::Connection> {
        match self {
            Self::Codex(adapter) => adapter.start(input, stop).await.map(Native::Codex),
            Self::Pi(adapter) => adapter.start(input, stop).await.map(Native::Pi),
        }
    }
}
impl<H: Hooks + 'static> Connection for Native<H> {
    fn session_id(&self) -> &str {
        match self {
            Self::Codex(native) => native.session_id(),
            Self::Pi(native) => native.session_id(),
        }
    }
    fn approval(&self) -> Approval {
        match self {
            Self::Codex(native) => native.approval(),
            Self::Pi(native) => native.approval(),
        }
    }
    fn lifetime(&self) -> CancellationToken {
        match self {
            Self::Codex(native) => native.lifetime(),
            Self::Pi(native) => native.lifetime(),
        }
    }
    async fn inspect(&self) -> Result<bool> {
        match self {
            Self::Codex(native) => native.inspect().await,
            Self::Pi(native) => native.inspect().await,
        }
    }
    async fn deliver(
        &self,
        text: &str,
        message: &str,
        stop: CancellationToken,
        priority: Option<InputPriority>,
    ) -> Result<()> {
        match self {
            Self::Codex(native) => native.deliver(text, message, stop, priority).await,
            Self::Pi(native) => native.deliver(text, message, stop, priority).await,
        }
    }
    async fn settle(&self, stop: CancellationToken) -> Result<bool> {
        match self {
            Self::Codex(native) => native.settle(stop).await,
            Self::Pi(native) => native.settle(stop).await,
        }
    }
    async fn recover(&self, text: &str, message: &str, stop: CancellationToken) -> Result<bool> {
        match self {
            Self::Codex(native) => native.recover(text, message, stop).await,
            Self::Pi(native) => native.recover(text, message, stop).await,
        }
    }
    fn acknowledge(&self, messages: &[String]) -> Result<()> {
        match self {
            Self::Codex(native) => native.acknowledge(messages),
            Self::Pi(native) => native.acknowledge(messages),
        }
    }
    async fn conversation(&self, room: &str, admission: Option<&Admission>) -> Result<Self> {
        match self {
            Self::Codex(native) => native.conversation(room, admission).await.map(Self::Codex),
            Self::Pi(native) => native.conversation(room, admission).await.map(Self::Pi),
        }
    }
    async fn close(&self) -> Result<()> {
        match self {
            Self::Codex(native) => native.close().await,
            Self::Pi(native) => native.close().await,
        }
    }
}
impl<H: Hooks + 'static> TurnControl for Native<H> {
    async fn active_turn(
        &self,
        room: Option<&str>,
        admission: Option<&Admission>,
    ) -> Result<Option<String>> {
        match self {
            Self::Codex(native) => native.active_turn(room, admission).await,
            Self::Pi(native) => native.active_turn(room, admission).await,
        }
    }
    async fn interrupt(
        &self,
        turn: &str,
        recovery: bool,
        admission: Option<&Admission>,
    ) -> Result<InterruptResult> {
        match self {
            Self::Codex(native) => native.interrupt(turn, recovery, admission).await,
            Self::Pi(native) => native.interrupt(turn, recovery, admission).await,
        }
    }
}
impl<H: Hooks + 'static> OwnedConnection for Native<H> {
    async fn provider(
        &self,
        cancellation: CancellationToken,
    ) -> Result<crossfire_agent_core::owned_runtime::ProviderState> {
        match self {
            Self::Codex(native) => native.provider(cancellation).await,
            Self::Pi(native) => native.provider(cancellation).await,
        }
    }
    async fn activity(&self) -> Result<NativeActivity> {
        match self {
            Self::Codex(native) => native.activity().await,
            Self::Pi(native) => native.activity().await,
        }
    }
    fn attachment(&self) -> Option<Attachment> {
        match self {
            Self::Codex(native) => native.attachment(),
            Self::Pi(native) => native.attachment(),
        }
    }
    async fn attachments(&self) -> Result<Vec<(String, Attachment)>> {
        match self {
            Self::Codex(native) => native.attachments().await,
            Self::Pi(native) => native.attachments().await,
        }
    }
}
