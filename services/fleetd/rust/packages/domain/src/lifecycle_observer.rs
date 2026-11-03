use crossfire_agent_core::{
    runtime::{Decision, Hooks, ObservationEvent},
    synchronization::CancellationToken,
};
use crossfire_domain::{
    runtime::values::{Setting, State},
    statistics::Usage,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::Clock};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicI64, AtomicU64, Ordering},
    },
};

pub struct Tracker<H, T> {
    hooks: Arc<H>,
    clock: Arc<T>,
    pub activity: AtomicI64,
    pub generation: AtomicU64,
    observations: Mutex<Observations>,
    error: Mutex<Option<Failure>>,
    stop: CancellationToken,
}
#[derive(Default)]
struct Observations {
    contexts: BTreeMap<String, ContextObservation>,
}
struct ContextObservation {
    state: State,
    settings: Vec<Setting>,
    observed_at: i64,
}
pub struct LifecycleHooks<H, T> {
    pub(crate) tracker: Arc<Tracker<H, T>>,
    pub(crate) generation: u64,
}
impl<H: Hooks, T: Clock> Tracker<H, T> {
    pub fn new(hooks: Arc<H>, clock: Arc<T>, now: i64, stop: CancellationToken) -> Self {
        Self {
            hooks,
            clock,
            activity: AtomicI64::new(now),
            generation: AtomicU64::new(0),
            observations: Mutex::new(Observations::default()),
            error: Mutex::new(None),
            stop,
        }
    }
    pub fn check(&self) -> Result<()> {
        match self
            .error
            .lock()
            .map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Native observation ownership failed",
                )
            })?
            .as_ref()
        {
            Some(error) => Err(error.clone()),
            None => Ok(()),
        }
    }
    pub fn settings(&self, session: &str, configured: &[Setting]) -> Result<Vec<Setting>> {
        Ok(self
            .observations
            .lock()
            .map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Native settings observation ownership failed",
                )
            })?
            .contexts
            .get(session)
            .map(|value| value.settings.clone())
            .unwrap_or_else(|| configured.to_vec()))
    }
    pub fn diagnostic_state(&self) -> Result<(String, Option<i64>)> {
        let observed = self.observations.lock().map_err(|_| self.ownership())?;
        let states = observed
            .contexts
            .values()
            .map(|value| value.state)
            .collect::<Vec<_>>();
        let state = [
            State::Failed,
            State::Unavailable,
            State::WaitingApproval,
            State::WaitingAnswer,
            State::Working,
            State::Idle,
        ]
        .into_iter()
        .find(|state| states.contains(state));
        Ok((
            state.map_or("unknown", State::code).to_owned(),
            observed
                .contexts
                .values()
                .filter(|value| Some(value.state) == state)
                .map(|value| value.observed_at)
                .max(),
        ))
    }
    pub fn touch(&self) -> Result<()> {
        self.activity.store(self.clock.now()?, Ordering::Release);
        self.check()
    }
    fn ownership(&self) -> Failure {
        Failure::new(
            ErrorCode::Unavailable,
            "Native observation ownership failed",
        )
    }
    fn observe(&self, event: &ObservationEvent) -> Result<()> {
        match event {
            ObservationEvent::Output { .. } => self.touch()?,
            ObservationEvent::State {
                session_id,
                state,
                settings,
                observed_at,
                ..
            } => {
                let mut observed = self.observations.lock().map_err(|_| self.ownership())?;
                let previous = {
                    if !observed.contexts.contains_key(session_id)
                        && observed.contexts.len() >= 2002
                    {
                        return Err(Failure::new(
                            ErrorCode::Limit,
                            "Native context observations exceed their bounded saved history count",
                        ));
                    }
                    observed
                        .contexts
                        .insert(
                            session_id.clone(),
                            ContextObservation {
                                state: *state,
                                settings: settings.clone(),
                                observed_at: *observed_at,
                            },
                        )
                        .map(|value| value.state)
                };
                let working = matches!(
                    state,
                    State::Working | State::WaitingAnswer | State::WaitingApproval
                );
                if working
                    || *state == State::Idle
                        && previous.is_some_and(|state| {
                            matches!(
                                state,
                                State::Working | State::WaitingAnswer | State::WaitingApproval
                            )
                        })
                {
                    self.touch()?;
                }
            }
        }
        Ok(())
    }
}
impl<H: Hooks, T: Clock + Send + Sync> Hooks for LifecycleHooks<H, T> {
    async fn request_decision(
        &self,
        decision: &Decision,
        stop: CancellationToken,
    ) -> Result<Value> {
        self.tracker.touch()?;
        self.tracker.hooks.request_decision(decision, stop).await
    }
    fn decision_responded(&self, decision: &Decision) {
        self.tracker.hooks.decision_responded(decision);
    }
    fn usage(&self, sample: &Usage) {
        self.tracker.hooks.usage(sample);
    }
    fn pending_decisions(&self) -> bool {
        self.tracker.hooks.pending_decisions()
    }
    fn pending_input(&self) -> bool {
        self.tracker.hooks.pending_input()
    }
    fn observe(&self, event: ObservationEvent) {
        if self.generation != self.tracker.generation.load(Ordering::Acquire)
            || self.tracker.stop.is_cancelled()
        {
            return;
        }
        if let Err(error) = self.tracker.observe(&event) {
            if let Ok(mut current) = self.tracker.error.lock() {
                current.get_or_insert(error);
            }
            self.tracker.stop.cancel();
            return;
        }
        self.tracker.hooks.observe(event);
    }
}
