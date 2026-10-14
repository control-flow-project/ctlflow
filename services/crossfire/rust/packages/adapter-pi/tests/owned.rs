use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_pi::owned::PiRuntime;
use crossfire_agent_core::{
    owned_runtime::{Input, OwnedConnection, Reset},
    runtime::{
        Connection, Decision, Hooks, InputPriority, InterruptResult, ObservationEvent, TurnControl,
    },
};
use crossfire_domain::{runtime::values::HistoryMode, statistics::Usage};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use crossfire_test_support::http::{Call, Fixture};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct Capture {
    events: Mutex<Vec<ObservationEvent>>,
    usage: Mutex<Vec<Usage>>,
    answer_questions: bool,
    answered: Mutex<Vec<String>>,
}
impl Hooks for Capture {
    async fn request_decision(
        &self,
        decision: &Decision,
        _cancellation: CancellationToken,
    ) -> Result<Value> {
        if self.answer_questions {
            let question = decision
                .questions
                .as_ref()
                .and_then(|questions| questions.first())
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Invalid, "Expected a typed owner question")
                })?;
            assert_eq!(
                question
                    .options
                    .iter()
                    .map(|option| option.label.as_str())
                    .collect::<Vec<_>>(),
                ["Go", "Stop"]
            );
            return Ok(json!({"answers":{(question.id.clone()):{"answers":["Go"]}}}));
        }
        Err(Failure::new(
            ErrorCode::Forbidden,
            "Unexpected native owner question",
        ))
    }
    fn decision_responded(&self, decision: &Decision) {
        if let Ok(mut responses) = self.answered.lock() {
            responses.push(decision.request_id.clone());
        }
    }
    fn usage(&self, usage: &Usage) {
        if let Ok(mut recorded) = self.usage.lock() {
            recorded.push(usage.clone());
        }
    }
    fn pending_decisions(&self) -> bool {
        false
    }
    fn pending_input(&self) -> bool {
        false
    }
    fn observe(&self, event: ObservationEvent) {
        if let Ok(mut recorded) = self.events.lock() {
            recorded.push(event);
        }
    }
}

#[tokio::test]
async fn real_pi_interrupts_captured_live_execution_and_accepts_the_next_directed_input_without_a_hold_queue()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let state = directory.path().join("state");
    let host = directory.path().join("host");
    PrivateDirectory::open(&state, true)?;
    let mut provider = Fixture::open().await?;
    configure(&host, &provider.origin)?;
    let runtime = PiRuntime {
        binary: binary()?,
        host_home: host,
    };
    let hooks = Arc::new(Capture::default());
    let connection = runtime
        .start(
            input(directory.path(), &state, &hooks, HistoryMode::Shared, true),
            CancellationToken::new(),
        )
        .await?;
    let (delivered, held) = tokio::join!(
        connection.deliver(
            "Work until interrupted.",
            "held-message",
            CancellationToken::new(),
            None
        ),
        provider.next()
    );
    delivered?;
    let held = held?;
    connection.acknowledge(&["held-message".to_owned()])?;
    let turn = connection
        .active_turn(None, None)
        .await?
        .ok_or("Actual captured native execution")?;
    assert_eq!(
        tokio::time::timeout(
            Duration::from_secs(5),
            connection.interrupt(&turn, false, None)
        )
        .await??,
        InterruptResult::Interrupted
    );
    held.close()?;
    let (delivered, served) = tokio::join!(
        connection.deliver(
            "Steering: answer this instead.",
            "steering-message",
            CancellationToken::new(),
            Some(InputPriority::Steering)
        ),
        async {
            let call = provider.next().await?;
            assert!(
                serde_json::to_string(&call.body)
                    .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid provider input"))?
                    .contains("Steering: answer this instead.")
            );
            response(call)
        }
    );
    delivered?;
    served?;
    connection.acknowledge(&["steering-message".to_owned()])?;
    idle(&connection).await?;
    assert_eq!(
        connection.interrupt(&turn, false, None).await?,
        InterruptResult::Inactive
    );
    connection.close().await?;
    Ok(())
}

#[tokio::test]
async fn real_pi_required_owner_question_receives_the_offered_answer_and_reports_only_after_native_delivery()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let state = directory.path().join("state");
    let host = directory.path().join("host");
    PrivateDirectory::open(&state, true)?;
    let mut provider = Fixture::open().await?;
    configure(&host, &provider.origin)?;
    let runtime = PiRuntime {
        binary: binary()?,
        host_home: host,
    };
    let hooks = Arc::new(Capture {
        answer_questions: true,
        ..Capture::default()
    });
    let connection = runtime
        .start(
            input(directory.path(), &state, &hooks, HistoryMode::Shared, true),
            CancellationToken::new(),
        )
        .await?;
    let (delivered, served) = tokio::join!(
        connection.deliver(
            "Ask the required owner question.",
            "question-message",
            CancellationToken::new(),
            None
        ),
        async {
            let first = provider.next().await?;
            let arguments = serde_json::to_string(
                &json!({"title":"Choose next step","prompt":"Proceed?","options":["Go","Stop"]}),
            )
            .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid question input"))?;
            let body = format!(
                "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
                json!({"id":"fixture-question","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call-question","type":"function","function":{"name":"crossfire_question","arguments":arguments}}]},"finish_reason":null}]}),
                json!({"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8,"prompt_tokens_details":{"cached_tokens":2}}})
            );
            first.raw(
                200,
                body.into_bytes(),
                BTreeMap::from([("Content-Type".to_owned(), "text/event-stream".to_owned())]),
            )?;
            let next = provider.next().await?;
            let content = serde_json::to_string(&next.body)
                .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid answered provider input"))?;
            assert!(content.contains("Go"));
            assert!(content.contains("answer"));
            response(next)
        }
    );
    delivered?;
    served?;
    connection.acknowledge(&["question-message".to_owned()])?;
    idle(&connection).await?;
    assert_eq!(
        hooks
            .answered
            .lock()
            .map_err(|_| "Delivered owner answers")?
            .len(),
        1
    );
    assert!(
        hooks
            .events
            .lock()
            .map_err(|_| "Events")?
            .iter()
            .any(|event| matches!(
                event,
                ObservationEvent::State {
                    state: crossfire_domain::runtime::values::State::WaitingAnswer,
                    ..
                }
            ))
    );
    connection.close().await?;
    Ok(())
}
fn configure(home: &Path, origin: &str) -> Result<()> {
    let directory = PrivateDirectory::open(home, true)?;
    directory.write_new("auth.json", b"{}")?;
    let models = json!({"providers":{"fixture":{"baseUrl":origin.to_owned()+"/v1","api":"openai-completions","apiKey":"inert-fixture-only","models":[{"id":"fixture-model","name":"Inert Pi fixture","reasoning":true,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":128000,"maxTokens":8192}]}}});
    directory.write_new(
        "models.json",
        &serde_json::to_vec(&models)
            .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid fixture models"))?,
    )
}
fn input(
    workspace: &Path,
    state: &Path,
    hooks: &Arc<Capture>,
    mode: HistoryMode,
    fresh: bool,
) -> Input<Capture> {
    Input {
        profile: "rust-pi-proof".to_owned(),
        name: "rust-pi-proof".to_owned(),
        workspace: workspace.to_owned(),
        state_directory: state.to_owned(),
        instructions: "Private native Pi role instructions. Historical marker silver orchard 913."
            .to_owned(),
        options: json!({"provider":"fixture","model":"fixture-model","thinking_level":"high"}),
        hooks: Arc::clone(hooks),
        history_mode: mode,
        allow_new_history: fresh,
    }
}
fn binary() -> std::result::Result<std::ffi::OsString, Box<dyn std::error::Error>> {
    std::env::var_os("CROSSFIRE_TEST_PI_BINARY")
        .ok_or_else(|| "Prepare the pinned Pi binary before Rust workers".into())
}
fn response(call: Call) -> Result<()> {
    assert_eq!(call.method, "POST");
    assert_eq!(call.target, "/v1/chat/completions");
    let body = format!(
        "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
        json!({"id":"fixture-chat","choices":[{"index":0,"delta":{"role":"assistant","content":"Fixture complete."},"finish_reason":null}]}),
        json!({"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3,"total_tokens":8,"prompt_tokens_details":{"cached_tokens":2}}})
    );
    call.raw(
        200,
        body.into_bytes(),
        BTreeMap::from([("Content-Type".to_owned(), "text/event-stream".to_owned())]),
    )
}
async fn idle(connection: &impl Connection) -> Result<()> {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            if !connection.inspect().await? {
                return Ok(());
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .map_err(|_| {
        Failure::new(
            ErrorCode::Native,
            "Native Pi did not settle within its observation bound",
        )
    })?
}

#[tokio::test]
async fn real_pi_owned_delivery_receipt_usage_output_and_saved_history_are_preserved_across_restart()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let state = directory.path().join("state");
    let host = directory.path().join("host");
    PrivateDirectory::open(&state, true)?;
    let mut provider = Fixture::open().await?;
    configure(&host, &provider.origin)?;
    let runtime = PiRuntime {
        binary: binary()?,
        host_home: host,
    };
    let hooks = Arc::new(Capture::default());
    let connection = runtime
        .start(
            input(directory.path(), &state, &hooks, HistoryMode::Shared, true),
            CancellationToken::new(),
        )
        .await?;
    let id = connection.session_id().to_owned();
    assert!(connection.attachment().is_none());
    assert!(connection.attachments().await?.is_empty());
    let (delivered, served) = tokio::join!(
        connection.deliver(
            "Retain historical fact azure 452.",
            "original-message",
            CancellationToken::new(),
            None
        ),
        async {
            let call = provider.next().await?;
            let body = serde_json::to_string(&call.body)
                .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid provider request"))?;
            assert!(body.contains("azure 452"));
            assert!(body.contains("silver orchard 913"));
            response(call)
        }
    );
    delivered?;
    served?;
    connection.acknowledge(&["original-message".to_owned()])?;
    idle(&connection).await?;
    assert!(hooks.events.lock().map_err(|_| "Events")?.iter().any(|event| matches!(event, ObservationEvent::Output { text, .. } if text.contains("Fixture complete."))));
    let sample = hooks
        .usage
        .lock()
        .map_err(|_| "Usage")?
        .last()
        .cloned()
        .ok_or("Native Pi usage")?;
    assert_eq!(sample.tokens.input, 5);
    assert_eq!(sample.tokens.cached_input, 2);
    assert_eq!(sample.tokens.output, 3);
    connection.close().await?;
    let resumed = runtime
        .start(
            input(directory.path(), &state, &hooks, HistoryMode::Shared, false),
            CancellationToken::new(),
        )
        .await?;
    assert_eq!(resumed.session_id(), id);
    let (delivered, served) = tokio::join!(
        resumed.deliver(
            "Use the retained historical fact.",
            "second-message",
            CancellationToken::new(),
            None
        ),
        async {
            let call = provider.next().await?;
            assert!(
                serde_json::to_string(&call.body)
                    .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid provider request"))?
                    .contains("azure 452")
            );
            response(call)
        }
    );
    delivered?;
    served?;
    resumed.acknowledge(&["second-message".to_owned()])?;
    idle(&resumed).await?;
    resumed.close().await?;
    Ok(())
}

#[tokio::test]
async fn real_pi_per_room_histories_stay_distinct_reset_is_explicit_and_live_owner_cannot_be_reset()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let state = directory.path().join("state");
    let host = directory.path().join("host");
    PrivateDirectory::open(&state, true)?;
    configure(&host, "http://127.0.0.1:1")?;
    let runtime = PiRuntime {
        binary: binary()?,
        host_home: host,
    };
    let hooks = Arc::new(Capture::default());
    let connection = runtime
        .start(
            input(directory.path(), &state, &hooks, HistoryMode::PerRoom, true),
            CancellationToken::new(),
        )
        .await?;
    let first = connection.conversation("!first:example", None).await?;
    let second = connection.conversation("!second:example", None).await?;
    assert_ne!(first.session_id(), second.session_id());
    assert_ne!(first.session_id(), connection.session_id());
    let saved = runtime.saved(&crossfire_agent_core::owned_runtime::Inspection {
        workspace: directory.path().to_owned(),
        state_directory: state.clone(),
        options: json!({}),
    })?;
    assert_eq!(saved.len(), 3);
    let reset = Reset {
        workspace: directory.path().to_owned(),
        state_directory: state.clone(),
        reset_id: identity::id(),
    };
    assert!(runtime.reset(&reset).is_err());
    connection.close().await?;
    runtime.reset(&reset)?;
    runtime.reset(&reset)?;
    assert_eq!(
        std::fs::read_dir(
            state
                .join(".pi/archive")
                .join(&reset.reset_id)
                .join("histories")
        )?
        .count(),
        3
    );
    let fresh = runtime
        .start(
            input(directory.path(), &state, &hooks, HistoryMode::PerRoom, true),
            CancellationToken::new(),
        )
        .await?;
    assert!(
        !saved
            .iter()
            .any(|context| context.session_id == fresh.session_id())
    );
    fresh.close().await?;
    Ok(())
}
