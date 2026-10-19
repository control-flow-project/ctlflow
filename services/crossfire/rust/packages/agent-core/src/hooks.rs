use crate::runtime::{Decision, Hooks, ObservationEvent};
use crossfire_domain::runtime::values::Setting;
use crossfire_domain::statistics::Usage;
use crossfire_kernel::Result;
use serde_json::Value;
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub struct ContextHooks<H> {
    pub owner: Arc<H>,
    pub context: String,
    pub extra_settings: Vec<Setting>,
}
impl<H: Hooks> Hooks for ContextHooks<H> {
    async fn request_decision(
        &self,
        decision: &Decision,
        cancellation: CancellationToken,
    ) -> Result<Value> {
        self.owner.request_decision(decision, cancellation).await
    }
    fn decision_responded(&self, decision: &Decision) {
        self.owner.decision_responded(decision);
    }
    fn usage(&self, sample: &Usage) {
        self.owner.usage(sample);
    }
    fn pending_decisions(&self) -> bool {
        self.owner.pending_decisions()
    }
    fn pending_input(&self) -> bool {
        self.owner.pending_input()
    }
    fn observe(&self, event: ObservationEvent) {
        let event = match event {
            ObservationEvent::State {
                runtime,
                session_id,
                state,
                observed_at,
                mut settings,
                error_message,
                ..
            } => {
                settings.extend(self.extra_settings.iter().cloned());
                ObservationEvent::State {
                    runtime,
                    session_id,
                    state,
                    observed_at,
                    settings,
                    error_message,
                    room_id: crossfire_kernel::history_context::room(&self.context)
                        .map(str::to_owned),
                }
            }
            event => event,
        };
        self.owner.observe(event);
    }
}
