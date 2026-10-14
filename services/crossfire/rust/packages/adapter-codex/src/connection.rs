use crate::{
    control,
    input::Input,
    protocol::{Event, Protocol},
    publication::CodexPublication,
    session::Session,
};
use crossfire_adapter_runtime::{delivery::Delivery, event_clock::EventClock};
use crossfire_agent_core::runtime::{
    Admission, Approval, Hooks, InputPriority, InterruptResult, TurnControl,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;
use std::{path::Path, sync::Arc};
use tokio_util::sync::CancellationToken;

pub struct CodexConnection<P, H> {
    session: Arc<Session<P>>,
    delivery: Delivery<Input, CodexPublication<P, H>, EventClock>,
    clock: EventClock,
    timeout_ms: u64,
}

impl<P: Protocol, H: Hooks> CodexConnection<P, H> {
    pub fn open(
        session: Arc<Session<P>>,
        hooks: Arc<H>,
        receipt_file: &Path,
        poll_ms: u64,
        timeout_ms: u64,
    ) -> Result<Self> {
        let clock = EventClock::default();
        let publication = CodexPublication::new(
            Arc::clone(&session),
            hooks,
            clock.clone(),
            receipt_file.to_owned(),
        );
        let delivery = Delivery::open(
            publication,
            clock.clone(),
            receipt_file,
            poll_ms,
            timeout_ms,
        )?;
        Ok(Self {
            session,
            delivery,
            clock,
            timeout_ms,
        })
    }
    pub fn session_id(&self) -> &str {
        &self.session.id
    }
    pub fn approval(&self) -> Approval {
        self.session.approval
    }
    pub fn lifetime(&self) -> CancellationToken {
        self.session.protocol.lifetime()
    }
    pub async fn inspect(&self) -> Result<bool> {
        self.delivery.inspect().await
    }
    pub async fn inspect_session(&self, session: &str) -> Result<bool> {
        Ok(self
            .session
            .current_for(session, self.lifetime())
            .await?
            .status
            == crate::session::Status::Active)
    }
    pub fn unsettled(&self) -> Result<bool> {
        self.delivery.unsettled()
    }
    pub fn acknowledge(&self, ids: &[String]) -> Result<()> {
        self.delivery.acknowledge(ids)
    }
    pub async fn deliver(
        &self,
        text: &str,
        id: &str,
        cancellation: CancellationToken,
        _priority: Option<InputPriority>,
    ) -> Result<()> {
        self.delivery.deliver(text, id, cancellation).await
    }
    pub async fn settle(&self, cancellation: CancellationToken) -> Result<bool> {
        self.delivery.settle(cancellation).await
    }
    pub async fn recover(
        &self,
        text: &str,
        id: &str,
        cancellation: CancellationToken,
    ) -> Result<bool> {
        self.delivery.recover(text, id, cancellation).await
    }
    pub async fn close(&self) -> Result<()> {
        self.delivery.close().await
    }
    pub fn event(&self, event: &Event) -> Result<()> {
        if event.params.get("threadId").and_then(Value::as_str) != Some(self.session.id.as_str()) {
            return Ok(());
        }
        let invalid = || {
            Failure::new(
                ErrorCode::Native,
                "The selected Codex thread is no longer available for input",
            )
        };
        if event.method == "thread/closed" {
            self.lifetime().cancel();
            return Err(invalid());
        }
        if event.method == "thread/status/changed" {
            if self.unsettled()?
                && !event
                    .params
                    .get("status")
                    .and_then(|value| value.get("type"))
                    .and_then(Value::as_str)
                    .is_some_and(|value| ["idle", "active"].contains(&value))
            {
                self.lifetime().cancel();
                return Err(invalid());
            }
            self.clock.changed();
        }
        if ["item/started", "item/completed"].contains(&event.method.as_str())
            && event
                .params
                .get("item")
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str)
                == Some("userMessage")
        {
            self.clock.changed();
        }
        Ok(())
    }
}

impl<P: Protocol, H: Hooks> TurnControl for CodexConnection<P, H> {
    async fn active_turn(
        &self,
        _room: Option<&str>,
        admission: Option<&Admission>,
    ) -> Result<Option<String>> {
        let cancellation = admission
            .map(|value| value.cancellation.clone())
            .unwrap_or_else(|| self.lifetime());
        control::active(&self.session, cancellation).await
    }
    async fn interrupt(
        &self,
        turn_id: &str,
        recovery: bool,
        admission: Option<&Admission>,
    ) -> Result<InterruptResult> {
        let cancellation = admission
            .map(|value| value.cancellation.clone())
            .unwrap_or_else(|| self.lifetime());
        let scope = crossfire_adapter_runtime::clock::Scope::new(&self.lifetime(), cancellation);
        control::interrupt(
            &self.session,
            turn_id,
            recovery,
            &self.clock,
            self.timeout_ms,
            scope.cancellation.clone(),
        )
        .await
    }
}
