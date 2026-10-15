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
struct Work(Mutex<Vec<ResumeWork>>);
impl WorkStore for Work {
    fn work(&self) -> Result<Vec<ResumeWork>> {
        Ok(self.0.lock().map_err(|_| failed())?.clone())
    }
    fn save_work(&self, values: &[ResumeWork]) -> Result<()> {
        *self.0.lock().map_err(|_| failed())? = values.to_vec();
        Ok(())
    }
}
#[derive(Default)]
struct State {
    starts: AtomicUsize,
    closes: AtomicUsize,
    busy: AtomicBool,
    closing_fails: AtomicBool,
    starting_fails: AtomicBool,
    native_stop: Mutex<Option<CancellationToken>>,
    contexts: Mutex<Vec<SavedContext>>,
    deliveries: Mutex<Vec<(String, String)>>,
    observations: Mutex<Vec<Arc<dyn Fn(ObservationEvent) + Send + Sync>>>,
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
        self.0.busy.store(false, Ordering::SeqCst);
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
        Ok(Native {
            state: self.0.clone(),
            stop,
        })
    }
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
    assert!(work.work()?.is_empty());
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
        work.work()?.is_empty(),
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
        Ok(self.state.busy.load(Ordering::SeqCst))
    }
    async fn deliver(
        &self,
        text: &str,
        message: &str,
        _stop: CancellationToken,
        _priority: Option<InputPriority>,
    ) -> Result<()> {
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
impl TurnControl for Native {
    async fn active_turn(
        &self,
        _room: Option<&str>,
        _admission: Option<&Admission>,
    ) -> Result<Option<String>> {
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
async fn active_work_is_not_slept_and_explicit_stop_resumes_with_a_checkpointed_reminder()
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
    )
    .await?;
    state.busy.store(true, Ordering::SeqCst);
    clock.store(3600000, Ordering::SeqCst);
    owner.maintain().await?;
    assert_eq!(state.closes.load(Ordering::SeqCst), 0);
    owner.stop_native(true).await?;
    assert_eq!(work.work()?.len(), 1);
    state.busy.store(false, Ordering::SeqCst);
    owner
        .runtime()?
        .deliver("next task", "next", CancellationToken::new(), None)
        .await?;
    {
        let messages = state.deliveries.lock().map_err(|_| failed())?;
        assert_eq!(messages.len(), 2);
        assert!(messages[0].1.contains("re-read the applicable AGENTS.md"));
        assert_eq!(messages[1].0, "next");
    }
    assert!(work.work()?.is_empty());
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
    )
    .await;
    assert_eq!(
        result.err().map(|error| error.code),
        Some(ErrorCode::Missing)
    );
    assert_eq!(state.starts.load(Ordering::SeqCst), 0);
    Ok(())
}
