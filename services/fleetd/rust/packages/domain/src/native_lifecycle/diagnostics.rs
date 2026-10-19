use super::*;
use crossfire_agent_core::owned_runtime::{NativeDiagnostic, ProviderState};

impl<
    A: OwnedAdapter<LifecycleHooks<H, W, T>>,
    H: Hooks + 'static,
    W: WorkStore + Send + Sync,
    T: Clock + Send + Sync,
> Owner<A, H, W, T>
{
    pub async fn diagnostics(&self, cancellation: CancellationToken) -> Result<NativeDiagnostic> {
        let (connection, phase, pending) = {
            let state = self.state.lock().map_err(|_| ownership())?;
            (
                state.native.clone(),
                state.phase,
                !state.unsettled.is_empty(),
            )
        };
        let (observed_state, observed_at) = self.tracker.diagnostic_state()?;
        let state = match phase {
            Phase::Running => observed_state,
            Phase::Sleeping => "sleeping".to_owned(),
            Phase::Waking => "waking".to_owned(),
            Phase::Failed => "failed".to_owned(),
        };
        let checked_at = self.clock.now()?;
        let mut diagnostic = NativeDiagnostic {
            checked_at,
            state,
            observed_at: if phase == Phase::Running {
                observed_at
            } else {
                Some(checked_at)
            },
            provider: ProviderState::Unknown,
            provider_observed_at: None,
            pending_input: pending || self.input.hooks.pending_input(),
            pending_decision: self.input.hooks.pending_decisions(),
        };
        if let Some(connection) = connection.filter(|native| !native.lifetime().is_cancelled()) {
            let provider = tokio::select! {
                _ = cancellation.cancelled() => None,
                _ = self.stop.cancelled() => None,
                value = connection.provider(cancellation.clone()) => value.ok(),
            };
            let current = self
                .state
                .lock()
                .map_err(|_| ownership())?
                .native
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &connection));
            if current
                && !connection.lifetime().is_cancelled()
                && !cancellation.is_cancelled()
                && let Some(provider) = provider
            {
                diagnostic.provider = provider;
                diagnostic.provider_observed_at = Some(self.clock.now()?);
            }
        }
        Ok(diagnostic)
    }
}
