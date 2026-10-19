use crate::{
    model::InterruptedContext,
    resume_work::{self, WorkStore},
};
use crossfire_agent_core::{
    owned_runtime::SavedContext,
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

pub struct Tracker<H, W, T> {
    hooks: Arc<H>,
    work: Arc<W>,
    clock: Arc<T>,
    primary: &'static str,
    pub activity: AtomicI64,
    pub generation: AtomicU64,
    observations: Mutex<Observations>,
    error: Mutex<Option<Failure>>,
    stop: CancellationToken,
}
#[derive(Default)]
struct Observations {
    recording: bool,
    revisions: BTreeMap<String, u64>,
    contexts: BTreeMap<String, ContextObservation>,
}
struct ContextObservation {
    state: State,
    settings: Vec<Setting>,
    observed_at: i64,
}
pub struct LifecycleHooks<H, W, T> {
    pub(crate) tracker: Arc<Tracker<H, W, T>>,
    pub(crate) generation: u64,
}
impl<H: Hooks, W: WorkStore, T: Clock> Tracker<H, W, T> {
    pub fn new(
        hooks: Arc<H>,
        work: Arc<W>,
        clock: Arc<T>,
        primary: &'static str,
        now: i64,
        stop: CancellationToken,
    ) -> Self {
        Self {
            hooks,
            work,
            clock,
            primary,
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
    pub fn suspend(&self) -> Result<()> {
        self.observations
            .lock()
            .map_err(|_| self.ownership())?
            .recording = false;
        Ok(())
    }
    pub fn capture_input(&self, context: InterruptedContext) -> Result<()> {
        let mut observed = self.observations.lock().map_err(|_| self.ownership())?;
        let revision = observed
            .revisions
            .entry(context.context.clone())
            .or_default();
        *revision = revision.wrapping_add(1);
        resume_work::capture(self.work.as_ref(), &[context], self.clock.now()?)
    }
    pub fn revisions(&self) -> Result<BTreeMap<String, u64>> {
        Ok(self
            .observations
            .lock()
            .map_err(|_| self.ownership())?
            .revisions
            .clone())
    }
    pub fn complete_idle(
        &self,
        revisions: &BTreeMap<String, u64>,
        completed: impl FnOnce() -> Result<Vec<InterruptedContext>>,
    ) -> Result<()> {
        let observed = self.observations.lock().map_err(|_| self.ownership())?;
        if !observed.recording {
            return Ok(());
        }
        let completed = completed()?
            .into_iter()
            .filter(|value| revisions.get(&value.context) == observed.revisions.get(&value.context))
            .collect::<Vec<_>>();
        resume_work::clear(self.work.as_ref(), &completed)
    }
    pub fn checkpoint(&self, contexts: &[SavedContext], recording: bool) -> Result<()> {
        let mut observed = self.observations.lock().map_err(|_| self.ownership())?;
        observed.recording = false;
        let active = contexts
            .iter()
            .filter(|context| {
                observed
                    .contexts
                    .get(&context.session_id)
                    .is_some_and(|value| {
                        matches!(
                            value.state,
                            State::Working | State::WaitingAnswer | State::WaitingApproval
                        )
                    })
            })
            .map(|context| InterruptedContext {
                context: context.context.clone(),
                session_id: context.session_id.clone(),
            })
            .collect::<Vec<_>>();
        resume_work::capture(self.work.as_ref(), &active, self.clock.now()?)?;
        observed.recording = recording;
        Ok(())
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
                room_id,
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
                if observed.recording && working {
                    let context = room_id
                        .as_deref()
                        .map(crossfire_kernel::history_context::for_room)
                        .unwrap_or_else(|| self.primary.to_owned());
                    let revision = observed.revisions.entry(context.clone()).or_default();
                    *revision = revision.wrapping_add(1);
                    resume_work::capture(
                        self.work.as_ref(),
                        &[InterruptedContext {
                            context,
                            session_id: session_id.clone(),
                        }],
                        self.clock.now()?,
                    )?;
                }
            }
        }
        Ok(())
    }
}
impl<H: Hooks, W: WorkStore + Send + Sync, T: Clock + Send + Sync> Hooks
    for LifecycleHooks<H, W, T>
{
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
