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
    revision: u64,
    settings: BTreeMap<String, (State, Vec<Setting>)>,
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
            .settings
            .get(session)
            .map(|(_, settings)| settings.clone())
            .unwrap_or_else(|| configured.to_vec()))
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
        observed.revision = observed.revision.wrapping_add(1);
        resume_work::capture(self.work.as_ref(), &[context], self.clock.now()?)
    }
    pub fn revision(&self) -> Result<u64> {
        Ok(self
            .observations
            .lock()
            .map_err(|_| self.ownership())?
            .revision)
    }
    pub fn complete_idle(
        &self,
        revision: u64,
        stable: impl FnOnce() -> Result<bool>,
    ) -> Result<()> {
        let observed = self.observations.lock().map_err(|_| self.ownership())?;
        if !observed.recording || observed.revision != revision || !stable()? {
            return Ok(());
        }
        if !self.work.work()?.is_empty() {
            self.work.save_work(&[])?;
        }
        Ok(())
    }
    pub fn checkpoint(&self, contexts: &[SavedContext], recording: bool) -> Result<()> {
        let mut observed = self.observations.lock().map_err(|_| self.ownership())?;
        observed.recording = false;
        let active = contexts
            .iter()
            .filter(|context| {
                observed
                    .settings
                    .get(&context.session_id)
                    .is_some_and(|(state, _)| {
                        matches!(
                            state,
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
                ..
            } => {
                let mut observed = self.observations.lock().map_err(|_| self.ownership())?;
                let previous = {
                    if !observed.settings.contains_key(session_id)
                        && observed.settings.len() >= 2002
                    {
                        return Err(Failure::new(
                            ErrorCode::Limit,
                            "Native context observations exceed their bounded saved history count",
                        ));
                    }
                    observed
                        .settings
                        .insert(session_id.clone(), (*state, settings.clone()))
                        .map(|(state, _)| state)
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
                    observed.revision = observed.revision.wrapping_add(1);
                    resume_work::capture(
                        self.work.as_ref(),
                        &[InterruptedContext {
                            context: room_id.clone().unwrap_or_else(|| self.primary.to_owned()),
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
