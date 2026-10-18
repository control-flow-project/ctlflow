use crossfire_agent_core::{
    owned_runtime::{
        Attachment, Input, Inspection, OwnedAdapter, OwnedConnection, Reset, SavedContext,
        Validation,
    },
    runtime::{
        Admission, Approval, Connection, Decision, Hooks, InputPriority, InterruptResult,
        Lifecycle, ObservationEvent, Phase, TurnControl,
    },
};
use crossfire_domain::{
    runtime::values::{HistoryMode, Runtime, Setting, State as NativeState},
    statistics::Usage,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::Clock};
use fleetd_domain::{
    model::ResumeWork,
    native_lifecycle::{Initial, Owner},
    resume_work::WorkStore,
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering},
    },
};
use tokio_util::sync::CancellationToken;

fn failed() -> Failure {
    Failure::new(ErrorCode::Unavailable, "Native fixture ownership failed")
}
struct Time(Arc<AtomicI64>);
impl Clock for Time {
    fn now(&self) -> Result<i64> {
        Ok(self.0.load(Ordering::SeqCst))
    }
}
struct Observer;
impl Hooks for Observer {
    async fn request_decision(
        &self,
        _decision: &Decision,
        _stop: CancellationToken,
    ) -> Result<Value> {
        Err(Failure::new(
            ErrorCode::Forbidden,
            "Fixture decisions require the owner",
        ))
    }
    fn decision_responded(&self, _decision: &Decision) {}
    fn usage(&self, _sample: &Usage) {}
    fn pending_decisions(&self) -> bool {
        false
    }
    fn pending_input(&self) -> bool {
        false
    }
    fn observe(&self, _event: ObservationEvent) {}
}
#[derive(Default)]
struct Work {
    values: Mutex<Vec<ResumeWork>>,
    reject: AtomicBool,
}
type Observers = Vec<Arc<dyn Fn(ObservationEvent) + Send + Sync>>;
type BeforeDelivery = Arc<dyn Fn() -> Result<()> + Send + Sync>;
type InspectionGate = (Arc<tokio::sync::Notify>, Arc<tokio::sync::Notify>);
impl WorkStore for Work {
    fn work(&self) -> Result<Vec<ResumeWork>> {
        Ok(self.values.lock().map_err(|_| failed())?.clone())
    }
    fn save_work(&self, values: &[ResumeWork]) -> Result<()> {
        if self.reject.load(Ordering::SeqCst) {
            return Err(failed());
        }
        *self.values.lock().map_err(|_| failed())? = values.to_vec();
        Ok(())
    }
}
#[derive(Default)]
struct State {
    starts: AtomicUsize,
    closes: AtomicUsize,
    busy: AtomicBool,
    inspection_fails: AtomicBool,
    working_on_start: AtomicBool,
    closing_fails: AtomicBool,
    starting_fails: AtomicBool,
    native_stop: Mutex<Option<CancellationToken>>,
    contexts: Mutex<Vec<SavedContext>>,
    deliveries: Mutex<Vec<(String, String)>>,
    observations: Mutex<Observers>,
    before_delivery: Mutex<Option<BeforeDelivery>>,
    inspection_gate: Mutex<Option<InspectionGate>>,
}
struct Adapter(Arc<State>);
struct Native {
    state: Arc<State>,
    stop: CancellationToken,
}
impl<H: Hooks + 'static> OwnedAdapter<H> for Adapter {
    type Connection = Native;
    fn configured_settings(&self, _options: &Value) -> Result<Vec<Setting>> {
        Ok(Vec::new())
    }
    fn validate(&self, _options: &Value) -> Result<Validation> {
        Ok(Validation {
            options: json!({}),
            approval: Approval::Runtime,
        })
    }
    async fn inspect(&self, _input: &Inspection, _stop: CancellationToken) -> Result<()> {
        Ok(())
    }
    async fn saved_contexts(&self, _input: &Inspection) -> Result<Vec<SavedContext>> {
        Ok(self.0.contexts.lock().map_err(|_| failed())?.clone())
    }
    async fn reset(&self, _input: &Reset) -> Result<()> {
        self.0.contexts.lock().map_err(|_| failed())?.clear();
        Ok(())
    }
    async fn start(&self, input: Input<H>, stop: CancellationToken) -> Result<Native> {
        self.0.starts.fetch_add(1, Ordering::SeqCst);
        if self.0.starting_fails.load(Ordering::SeqCst) {
            return Err(failed());
        }
        self.0.busy.store(
            self.0.working_on_start.load(Ordering::SeqCst),
            Ordering::SeqCst,
        );
        let hooks = input.hooks.clone();
        self.0
            .observations
            .lock()
            .map_err(|_| failed())?
            .push(Arc::new(move |event| hooks.observe(event)));
        let mut contexts = self.0.contexts.lock().map_err(|_| failed())?;
        if contexts.is_empty() {
            if !input.allow_new_history {
                return Err(Failure::new(
                    ErrorCode::Missing,
                    "Fixture requires exact saved history",
                ));
            }
            contexts.push(SavedContext {
                context: "shared".to_owned(),
                runtime: "codex".to_owned(),
                session_id: "saved".to_owned(),
                workspace: input.workspace,
            });
        }
        *self.0.native_stop.lock().map_err(|_| failed())? = Some(stop.clone());
        input.hooks.observe(ObservationEvent::State {
            runtime: Runtime::Codex,
            session_id: "saved".into(),
            room_id: None,
            state: if self.0.working_on_start.load(Ordering::SeqCst) {
                NativeState::Working
            } else {
                NativeState::Idle
            },
            observed_at: 1,
            settings: vec![],
            error_message: None,
        });
        Ok(Native {
            state: self.0.clone(),
            stop,
        })
    }
}

#[tokio::test]
async fn failed_or_unloaded_thread_observations_do_not_replace_a_live_native_process()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(State::default());
    let work = Arc::new(Work::default());
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        work,
        Time(Arc::new(AtomicI64::new(1))),
        Initial::Start,
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    let observers = state.observations.lock().map_err(|_| failed())?.clone();
    for status in [NativeState::Unavailable, NativeState::Failed] {
        for observer in &observers {
            observer(ObservationEvent::State {
                runtime: Runtime::Codex,
                session_id: "saved".to_owned(),
                room_id: None,
                state: status,
                observed_at: 1,
                settings: Vec::new(),
                error_message: None,
            });
        }
        owner.maintain().await?;
        assert_eq!(owner.current()?.phase, Phase::Running);
        assert_eq!(
            state.starts.load(Ordering::SeqCst),
            1,
            "Only a disconnected native lifetime can authorize automatic process replacement"
        );
        assert_eq!(state.closes.load(Ordering::SeqCst), 0);
    }
    owner.close().await?;
    Ok(())
}
#[tokio::test]
async fn observations_checkpoint_work_before_a_crash_and_ignore_a_replaced_process_generation()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(State::default());
    let clock = Arc::new(AtomicI64::new(1));
    let work = Arc::new(Work::default());
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        work.clone(),
        Time(clock.clone()),
        Initial::Start,
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    let observation = state
        .observations
        .lock()
        .map_err(|_| failed())?
        .first()
        .cloned()
        .ok_or("Native observer")?;
    let event = |state| ObservationEvent::State {
        runtime: Runtime::Codex,
        session_id: "saved".to_owned(),
        room_id: None,
        state,
        observed_at: 1,
        settings: vec![],
        error_message: None,
    };
    clock.store(20, Ordering::SeqCst);
    observation(event(NativeState::Working));
    assert_eq!(work.work()?.len(), 1);
    assert_eq!(owner.current()?.last_activity_at, Some(20));
    state
        .native_stop
        .lock()
        .map_err(|_| failed())?
        .as_ref()
        .ok_or("Native lifetime")?
        .cancel();
    owner.maintain().await?;
    assert_eq!(state.starts.load(Ordering::SeqCst), 2);
    let resumed = work.work()?;
    assert_eq!(resumed.len(), 1);
    assert!(
        state
            .deliveries
            .lock()
            .map_err(|_| failed())?
            .iter()
            .any(|(_, text)| text.contains("Your saved session was restarted"))
    );
    observation(event(NativeState::Working));
    assert!(
        work.work()? == resumed,
        "The replaced native generation cannot recreate unfinished work"
    );
    let current = state
        .observations
        .lock()
        .map_err(|_| failed())?
        .last()
        .cloned()
        .ok_or("Current native observer")?;
    clock.store(30, Ordering::SeqCst);
    current(event(NativeState::Working));
    assert_eq!(work.work()?.len(), 1);
    clock.store(40, Ordering::SeqCst);
    current(event(NativeState::Idle));
    assert_eq!(work.work()?.len(), 1);
    assert!(!owner.runtime()?.inspect().await?);
    assert!(work.work()?.is_empty());
    clock.store(50, Ordering::SeqCst);
    current(event(NativeState::Idle));
    assert_eq!(
        owner.current()?.last_activity_at,
        Some(40),
        "Repeated idle reporting must not postpone automatic sleep"
    );
    owner.close().await?;
    Ok(())
}
impl Connection for Native {
    fn session_id(&self) -> &str {
        "saved"
    }
    fn approval(&self) -> Approval {
        Approval::Runtime
    }
    fn lifetime(&self) -> CancellationToken {
        self.stop.clone()
    }
    async fn inspect(&self) -> Result<bool> {
        if self.state.inspection_fails.load(Ordering::SeqCst) {
            return Err(failed());
        }
        let busy = self.state.busy.load(Ordering::SeqCst);
        let gate = self
            .state
            .inspection_gate
            .lock()
            .map_err(|_| failed())?
            .clone();
        if let Some((entered, release)) = gate {
            entered.notify_one();
            release.notified().await;
        }
        Ok(busy)
    }
    async fn deliver(
        &self,
        text: &str,
        message: &str,
        _stop: CancellationToken,
        _priority: Option<InputPriority>,
    ) -> Result<()> {
        let check = self
            .state
            .before_delivery
            .lock()
            .map_err(|_| failed())?
            .clone();
        if let Some(check) = check {
            check()?;
        }
        self.state
            .deliveries
            .lock()
            .map_err(|_| failed())?
            .push((message.to_owned(), text.to_owned()));
        Ok(())
    }
    async fn settle(&self, _stop: CancellationToken) -> Result<bool> {
        Ok(false)
    }
    async fn recover(&self, text: &str, message: &str, _stop: CancellationToken) -> Result<bool> {
        Ok(self
            .state
            .deliveries
            .lock()
            .map_err(|_| failed())?
            .iter()
            .any(|(id, content)| id == message && content == text))
    }
    fn acknowledge(&self, _messages: &[String]) -> Result<()> {
        Ok(())
    }
    async fn conversation(&self, _room: &str, _admission: Option<&Admission>) -> Result<Self> {
        Ok(Self {
            state: self.state.clone(),
            stop: self.stop.clone(),
        })
    }
    async fn close(&self) -> Result<()> {
        if self.state.closing_fails.load(Ordering::SeqCst) {
            return Err(failed());
        }
        self.state.closes.fetch_add(1, Ordering::SeqCst);
        self.stop.cancel();
        Ok(())
    }
}

#[path = "support/native_work.rs"]
mod native_work;
impl TurnControl for Native {
    async fn active_turn(
        &self,
        _room: Option<&str>,
        _admission: Option<&Admission>,
    ) -> Result<Option<String>> {
        if self.state.inspection_fails.load(Ordering::SeqCst) {
            return Err(failed());
        }
        Ok(self
            .state
            .busy
            .load(Ordering::SeqCst)
            .then(|| "active-turn".to_owned()))
    }
    async fn interrupt(
        &self,
        _turn: &str,
        _recovery: bool,
        _admission: Option<&Admission>,
    ) -> Result<InterruptResult> {
        self.state.busy.store(false, Ordering::SeqCst);
        Ok(InterruptResult::Interrupted)
    }
}
impl OwnedConnection for Native {
    fn attachment(&self) -> Option<Attachment> {
        None
    }
    async fn attachments(&self) -> Result<Vec<(String, Attachment)>> {
        Ok(Vec::new())
    }
}
fn input() -> Input<Observer> {
    Input {
        profile: "analyst".to_owned(),
        name: "Analyst".to_owned(),
        workspace: PathBuf::from("/native/workspace"),
        state_directory: PathBuf::from("/native/private"),
        instructions: "Current instructions".to_owned(),
        options: json!({}),
        hooks: Arc::new(Observer),
        history_mode: HistoryMode::Shared,
        allow_new_history: true,
    }
}

#[tokio::test]
async fn exact_history_sleeps_at_thirty_minutes_and_wakes_on_the_same_identity()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(State::default());
    let clock = Arc::new(AtomicI64::new(1));
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        Arc::new(Work::default()),
        Time(clock.clone()),
        Initial::Start,
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    let logical = owner.runtime()?;
    assert_eq!(logical.approval(), Approval::Runtime);
    clock.store(1800000, Ordering::SeqCst);
    owner.maintain().await?;
    assert_eq!(owner.current()?.phase, Phase::Running);
    clock.store(1800001, Ordering::SeqCst);
    owner.maintain().await?;
    assert_eq!(owner.current()?.phase, Phase::Sleeping);
    assert!(!logical.lifetime().is_cancelled());
    assert_eq!(state.closes.load(Ordering::SeqCst), 1);
    logical
        .deliver("new chat", "message", CancellationToken::new(), None)
        .await?;
    assert_eq!(logical.session_id(), "saved");
    assert_eq!(state.starts.load(Ordering::SeqCst), 2);
    assert_eq!(owner.current()?.phase, Phase::Running);
    clock.store(3600002, Ordering::SeqCst);
    owner.maintain().await?;
    assert_eq!(owner.current()?.phase, Phase::Running);
    logical.acknowledge(&["message".to_owned()])?;
    owner.maintain().await?;
    assert_eq!(owner.current()?.phase, Phase::Sleeping);
    owner.close().await?;
    Ok(())
}

#[tokio::test]
async fn crashed_native_process_is_closed_before_replacement_and_failed_close_blocks_every_start()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(State::default());
    let clock = Arc::new(AtomicI64::new(1));
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        Arc::new(Work::default()),
        Time(clock),
        Initial::Start,
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await?;
    state
        .native_stop
        .lock()
        .map_err(|_| failed())?
        .as_ref()
        .ok_or("native lifetime required")?
        .cancel();
    state.closing_fails.store(true, Ordering::SeqCst);
    assert!(owner.maintain().await.is_err());
    assert_eq!(state.starts.load(Ordering::SeqCst), 1);
    state.closing_fails.store(false, Ordering::SeqCst);
    state.starting_fails.store(true, Ordering::SeqCst);
    assert!(owner.maintain().await.is_err());
    assert_eq!(owner.current()?.phase, Phase::Failed);
    state.starting_fails.store(false, Ordering::SeqCst);
    owner.maintain().await?;
    assert_eq!(owner.current()?.phase, Phase::Running);
    assert_eq!(state.starts.load(Ordering::SeqCst), 3);
    owner.close().await?;
    Ok(())
}
#[tokio::test]
async fn missing_saved_sleeping_history_fails_without_a_process_or_replacement()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let state = Arc::new(State::default());
    let result = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        Arc::new(Work::default()),
        Time(Arc::new(AtomicI64::new(1))),
        Initial::ResumeSleeping,
        CancellationToken::new(),
        Arc::new(crossfire_agent_core::listener_budget::Budget::default()),
    )
    .await;
    assert_eq!(
        result.err().map(|error| error.code),
        Some(ErrorCode::Missing)
    );
    assert_eq!(state.starts.load(Ordering::SeqCst), 0);
    Ok(())
}

#[tokio::test]
async fn steering_never_waits_in_a_full_native_start_queue()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    use crossfire_agent_core::listener_budget::{Budget, Work as NativeWork};
    let state = Arc::new(State::default());
    state
        .contexts
        .lock()
        .map_err(|_| failed())?
        .push(SavedContext {
            context: "shared".into(),
            runtime: "codex".into(),
            session_id: "saved".into(),
            workspace: "/fixture".into(),
        });
    let budget = Arc::new(Budget::default());
    let mut leases = vec![];
    for _ in 0..4 {
        leases.push(
            budget
                .acquire(NativeWork::NativeStart, CancellationToken::new(), false)
                .await?,
        );
    }
    let owner = Owner::open(
        Arc::new(Adapter(state.clone())),
        input(),
        Arc::new(Work::default()),
        Time(Arc::new(AtomicI64::new(1))),
        Initial::ResumeSleeping,
        CancellationToken::new(),
        budget,
    )
    .await?;
    let admission = Admission {
        priority: InputPriority::Steering,
        cancellation: CancellationToken::new(),
    };
    assert!(
        owner
            .runtime()?
            .active_turn(None, Some(&admission))
            .await
            .is_err()
    );
    assert_eq!(state.starts.load(Ordering::SeqCst), 0);
    drop(leases);
    owner.resume().await?;
    assert_eq!(state.starts.load(Ordering::SeqCst), 1);
    owner.close().await?;
    Ok(())
}
