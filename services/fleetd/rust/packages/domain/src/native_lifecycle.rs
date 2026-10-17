mod logical;
use crate::{
    lifecycle_observer::{LifecycleHooks, Tracker},
    resume_work::{self, WorkStore},
};
use crossfire_agent_core::synchronization::{CancellationToken, Mutex as AsyncMutex};
use crossfire_agent_core::{
    listener_budget::{Budget, Work},
    owned_runtime::{Attachment, Input, Inspection, OwnedAdapter, OwnedConnection, SavedContext},
    runtime::{
        Admission, Approval, Connection, Hooks, InputPriority, InterruptResult, Lifecycle,
        ObservationEvent, Phase, SessionState, TurnControl,
    },
    synchronization::StartupScope,
};
use crossfire_domain::runtime::values::{HistoryMode, Runtime, State as NativeState};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::Clock};
use std::{
    collections::BTreeSet,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Initial {
    Start,
    ResumeSleeping,
}
struct State<N> {
    native: Option<Arc<N>>,
    phase: Phase,
    idle_seconds: i64,
    session: String,
    contexts: Vec<SavedContext>,
    unsettled: BTreeSet<String>,
}
pub struct Owner<
    A: OwnedAdapter<LifecycleHooks<H, W, T>>,
    H: Hooks,
    W: WorkStore + Send + Sync,
    T: Clock + Send + Sync,
> {
    adapter: Arc<A>,
    input: Input<H>,
    work: Arc<W>,
    clock: Arc<T>,
    tracker: Arc<Tracker<H, W, T>>,
    state: Mutex<State<A::Connection>>,
    transition: AsyncMutex<()>,
    calls: AtomicUsize,
    stop: CancellationToken,
    approval: Approval,
    budget: Arc<Budget>,
}
pub struct Logical<
    A: OwnedAdapter<LifecycleHooks<H, W, T>>,
    H: Hooks,
    W: WorkStore + Send + Sync,
    T: Clock + Send + Sync,
> {
    owner: Arc<Owner<A, H, W, T>>,
    room: Option<String>,
    session: String,
}
fn unavailable(message: &str) -> Failure {
    Failure::new(ErrorCode::Unavailable, message)
}
fn ownership() -> Failure {
    unavailable("Native lifecycle state ownership failed")
}
impl<
    A: OwnedAdapter<LifecycleHooks<H, W, T>>,
    H: Hooks + 'static,
    W: WorkStore + Send + Sync,
    T: Clock + Send + Sync,
> Owner<A, H, W, T>
{
    pub async fn open(
        adapter: Arc<A>,
        input: Input<H>,
        work: Arc<W>,
        clock: T,
        initial: Initial,
        stop: CancellationToken,
        budget: Arc<Budget>,
    ) -> Result<Arc<Self>> {
        let approval = adapter.validate(&input.options)?.approval;
        let inspection = Inspection {
            workspace: input.workspace.clone(),
            state_directory: input.state_directory.clone(),
            options: input.options.clone(),
        };
        let contexts = adapter.saved_contexts(&inspection).await?;
        let primary = match input.history_mode {
            HistoryMode::Shared => "shared",
            HistoryMode::PerRoom => "control",
        };
        let session = contexts
            .iter()
            .find(|context| context.context == primary)
            .map(|context| context.session_id.clone())
            .unwrap_or_default();
        if initial == Initial::ResumeSleeping && session.is_empty() {
            return Err(Failure::new(
                ErrorCode::Missing,
                "Exact saved history is missing; a sleeping resume never creates a replacement",
            ));
        }
        let activity = clock.now()?;
        let clock = Arc::new(clock);
        let tracker = Arc::new(Tracker::new(
            input.hooks.clone(),
            work.clone(),
            clock.clone(),
            primary,
            activity,
            stop.clone(),
        ));
        let owner = Arc::new(Self {
            adapter,
            input,
            work,
            clock,
            tracker,
            state: Mutex::new(State {
                native: None,
                phase: Phase::Sleeping,
                idle_seconds: 1800,
                session,
                contexts,
                unsettled: BTreeSet::new(),
            }),
            transition: AsyncMutex::new(()),
            calls: AtomicUsize::new(0),
            stop,
            approval,
            budget,
        });
        if (initial == Initial::Start
            || owner.input.hooks.pending_decisions()
            || !owner.work.work()?.is_empty())
            && let Err(error) = owner.ensure(None).await
        {
            owner.close().await?;
            return Err(error);
        }
        if owner.current()?.phase == Phase::Sleeping {
            owner.observe(NativeState::Sleeping, None)?;
        }
        Ok(owner)
    }
    fn primary(&self) -> &'static str {
        match self.input.history_mode {
            HistoryMode::Shared => "shared",
            HistoryMode::PerRoom => "control",
        }
    }
    pub async fn contexts(&self) -> Result<Vec<SavedContext>> {
        self.adapter
            .saved_contexts(&Inspection {
                workspace: self.input.workspace.clone(),
                state_directory: self.input.state_directory.clone(),
                options: self.input.options.clone(),
            })
            .await
    }
    pub async fn resume(&self) -> Result<()> {
        self.ensure(None).await?;
        Ok(())
    }
    pub async fn attachment(&self, context: Option<&str>) -> Result<Attachment> {
        let native = self.state.lock().map_err(|_| ownership())?.native.clone().filter(|native| !native.lifetime().is_cancelled())
            .ok_or_else(|| Failure::new(ErrorCode::Conflict,"Resume this agent before attaching its terminal; reading a pointer never starts a session"))?;
        let context = context.unwrap_or(self.primary());
        let attachments = native.attachments().await?;
        if attachments.is_empty() {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "This native runtime does not support terminal attachment",
            ));
        }
        attachments
            .into_iter()
            .find(|(key, _)| key == context)
            .map(|(_, attachment)| attachment)
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Missing,
                    "The selected native history has no available terminal attachment",
                )
            })
    }
    fn observe(&self, phase: NativeState, error: Option<&Failure>) -> Result<()> {
        let contexts = self.state.lock().map_err(|_| ownership())?.contexts.clone();
        let configured = self.adapter.configured_settings(&self.input.options)?;
        for context in contexts {
            self.input.hooks.observe(ObservationEvent::State {
                runtime: Runtime::parse(&context.runtime)?,
                settings: self.tracker.settings(&context.session_id, &configured)?,
                session_id: context.session_id,
                room_id: (!matches!(context.context.as_str(), "shared" | "control"))
                    .then_some(context.context),
                state: phase,
                observed_at: self.clock.now()?,
                error_message: error.map(|error| {
                    crossfire_kernel::text::truncate_utf8(&error.message, 4000).to_owned()
                }),
            });
        }
        Ok(())
    }
    pub fn runtime(self: &Arc<Self>) -> Result<Logical<A, H, W, T>> {
        let session = self.state.lock().map_err(|_| ownership())?.session.clone();
        if session.is_empty() {
            return Err(Failure::new(
                ErrorCode::Missing,
                "Native runtime has not established its exact saved identity",
            ));
        }
        Ok(Logical {
            owner: self.clone(),
            room: None,
            session,
        })
    }
    async fn ensure(&self, admission: Option<&Admission>) -> Result<Arc<A::Connection>> {
        if self.stop.is_cancelled() {
            return Err(unavailable("Native lifecycle is stopped"));
        }
        let caller = admission.map(|value| &value.cancellation);
        let mut scope = StartupScope::new(&self.stop, caller);
        let immediate = admission.is_some();
        let _transition = if immediate {
            self.transition.try_lock().map_err(|_| {
                unavailable(
                    "Native activation is already in progress; immediate input was not accepted",
                )
            })?
        } else {
            tokio::select! { biased; _=scope.cancellation.cancelled()=>return Err(unavailable("Native activation was cancelled")), value=self.transition.lock()=>value }
        };
        let current = self.state.lock().map_err(|_| ownership())?.native.clone();
        if let Some(current) = current {
            if !current.lifetime().is_cancelled()
                && self.state.lock().map_err(|_| ownership())?.phase == Phase::Running
            {
                return Ok(current);
            }
            self.state.lock().map_err(|_| ownership())?.phase = Phase::Failed;
            self.discard(&current).await?;
        }
        let _permit = self
            .budget
            .acquire(Work::NativeStart, scope.cancellation.clone(), immediate)
            .await?;
        let original = self.state.lock().map_err(|_| ownership())?.session.clone();
        let mut input = self.input.clone();
        input.allow_new_history &= original.is_empty();
        self.state.lock().map_err(|_| ownership())?.phase = Phase::Waking;
        self.observe(NativeState::Waking, None)?;
        self.tracker.suspend()?;
        let generation = self
            .tracker
            .generation
            .fetch_add(1, Ordering::AcqRel)
            .wrapping_add(1);
        let input = Input {
            profile: input.profile,
            name: input.name,
            workspace: input.workspace,
            state_directory: input.state_directory,
            instructions: input.instructions,
            options: input.options,
            hooks: Arc::new(LifecycleHooks {
                tracker: self.tracker.clone(),
                generation,
            }),
            history_mode: input.history_mode,
            allow_new_history: input.allow_new_history,
        };
        let connected = match self.adapter.start(input, scope.cancellation.clone()).await {
            Ok(native) => Arc::new(native),
            Err(error) => {
                self.state.lock().map_err(|_| ownership())?.phase = Phase::Failed;
                self.observe(NativeState::Failed, Some(&error))?;
                return Err(error);
            }
        };
        self.state.lock().map_err(|_| ownership())?.native = Some(connected.clone());
        let result = async {
            scope.transfer(caller).await?;
            if !original.is_empty() && connected.session_id() != original {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "The resumed native history differs from its saved primary identity",
                ));
            }
            let contexts = self.contexts().await?;
            if !contexts.iter().any(|context| {
                context.context == self.primary() && context.session_id == connected.session_id()
            }) {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Native activation did not retain its exact saved primary history",
                ));
            }
            resume_work::resume(
                connected.as_ref(),
                self.primary(),
                &contexts,
                self.work.as_ref(),
            )
            .await?;
            self.tracker.checkpoint(&contexts, true)?;
            Ok(contexts)
        }
        .await;
        let contexts = match result {
            Ok(contexts) => contexts,
            Err(error) => {
                self.state.lock().map_err(|_| ownership())?.phase = Phase::Failed;
                self.discard(&connected).await?;
                self.observe(NativeState::Failed, Some(&error))?;
                return Err(error);
            }
        };
        let mut state = self.state.lock().map_err(|_| ownership())?;
        state.session = connected.session_id().to_owned();
        state.contexts = contexts;
        state.native = Some(connected.clone());
        state.phase = Phase::Running;
        self.tracker.touch()?;
        Ok(connected)
    }
    async fn discard(&self, native: &Arc<A::Connection>) -> Result<()> {
        self.tracker.suspend()?;
        native.close().await.map_err(|_| {
            if let Ok(mut state) = self.state.lock() {
                state.phase = Phase::Failed;
            }
            Failure::new(
                ErrorCode::Conflict,
                "Native close is not proved; replacement is blocked until cleanup succeeds",
            )
        })?;
        self.tracker.generation.fetch_add(1, Ordering::AcqRel);
        let mut state = self.state.lock().map_err(|_| ownership())?;
        if state
            .native
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, native))
        {
            state.native = None;
        }
        Ok(())
    }
    pub async fn maintain(&self) -> Result<()> {
        self.tracker.check()?;
        if self.stop.is_cancelled() {
            return Ok(());
        }
        let (native, phase) = {
            let state = self.state.lock().map_err(|_| ownership())?;
            (state.native.clone(), state.phase)
        };
        let Some(native) = native else {
            if phase == Phase::Failed {
                self.ensure(None).await?;
            }
            return Ok(());
        };
        if native.lifetime().is_cancelled() {
            self.ensure(None).await?;
            return Ok(());
        }
        let due = {
            let state = self.state.lock().map_err(|_| ownership())?;
            state.idle_seconds > 0
                && self
                    .clock
                    .now()?
                    .saturating_sub(self.tracker.activity.load(Ordering::Acquire))
                    >= state.idle_seconds * 1000
                && state.unsettled.is_empty()
                && self.calls.load(Ordering::Acquire) == 0
        };
        if !due
            || self.input.hooks.pending_decisions()
            || self.input.hooks.pending_input()
            || native.inspect().await?
        {
            return Ok(());
        }
        let Ok(_transition) = self.transition.try_lock() else {
            return Ok(());
        };
        {
            let state = self.state.lock().map_err(|_| ownership())?;
            if self.calls.load(Ordering::Acquire) != 0
                || !state.unsettled.is_empty()
                || state
                    .native
                    .as_ref()
                    .is_none_or(|current| !Arc::ptr_eq(current, &native))
            {
                return Ok(());
            }
        }
        self.discard(&native).await?;
        self.state.lock().map_err(|_| ownership())?.phase = Phase::Sleeping;
        self.observe(NativeState::Sleeping, None)?;
        Ok(())
    }
    pub async fn stop_native(&self, preserve_work: bool) -> Result<()> {
        let _transition = self.transition.lock().await;
        let Some(native) = self.state.lock().map_err(|_| ownership())?.native.clone() else {
            return Ok(());
        };
        if preserve_work {
            self.tracker.checkpoint(&self.contexts().await?, false)?;
        }
        self.discard(&native).await?;
        self.state.lock().map_err(|_| ownership())?.phase = Phase::Sleeping;
        self.observe(NativeState::Sleeping, None)?;
        Ok(())
    }
    pub async fn close(&self) -> Result<()> {
        self.stop.cancel();
        self.stop_native(true).await
    }
    fn touch(&self, message: Option<&str>) -> Result<()> {
        let mut state = self.state.lock().map_err(|_| ownership())?;
        self.tracker.touch()?;
        if let Some(message) = message {
            state.unsettled.insert(message.to_owned());
        }
        Ok(())
    }
}
impl<
    A: OwnedAdapter<LifecycleHooks<H, W, T>>,
    H: Hooks,
    W: WorkStore + Send + Sync,
    T: Clock + Send + Sync,
> Lifecycle for Owner<A, H, W, T>
{
    fn current(&self) -> Result<SessionState> {
        self.tracker.check()?;
        let state = self.state.lock().map_err(|_| ownership())?;
        Ok(SessionState {
            phase: if state.phase == Phase::Running
                && state
                    .native
                    .as_ref()
                    .is_some_and(|native| native.lifetime().is_cancelled())
            {
                Phase::Failed
            } else {
                state.phase
            },
            last_activity_at: Some(self.tracker.activity.load(Ordering::Acquire)),
            history_available: !state.session.is_empty(),
        })
    }
    fn configure_idle(&self, seconds: i64) -> Result<()> {
        if !(0..=604800).contains(&seconds) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid native idle timeout",
            ));
        }
        self.state.lock().map_err(|_| ownership())?.idle_seconds = seconds;
        Ok(())
    }
}
