use crossfire_adapter_codex::{
    callbacks::SessionCallbacks,
    observation::Observer,
    protocol::{Callbacks, Event, Request, RequestId},
};
use crossfire_agent_core::runtime::{Decision, Hooks, ObservationEvent};
use crossfire_domain::{runtime::values::State, statistics::Usage};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct Capture {
    events: Mutex<Vec<ObservationEvent>>,
    decisions: Mutex<Vec<String>>,
    responded: Mutex<Vec<String>>,
    answer: Mutex<Option<Value>>,
    cancel: bool,
}
impl Hooks for Capture {
    async fn request_decision(
        &self,
        decision: &Decision,
        cancellation: CancellationToken,
    ) -> Result<Value> {
        self.decisions
            .lock()
            .map_err(|_| Failure::new(ErrorCode::Native, "Fixture poisoned"))?
            .push(decision.request_id.clone());
        if self.cancel {
            cancellation.cancel();
        }
        self.answer
            .lock()
            .map_err(|_| Failure::new(ErrorCode::Native, "Fixture poisoned"))?
            .take()
            .ok_or_else(|| Failure::new(ErrorCode::Forbidden, "No owner answer"))
    }
    fn decision_responded(&self, decision: &Decision) {
        if let Ok(mut responded) = self.responded.lock() {
            responded.push(decision.request_id.clone());
        }
    }
    fn usage(&self, _sample: &Usage) {}
    fn pending_decisions(&self) -> bool {
        false
    }
    fn pending_input(&self) -> bool {
        false
    }
    fn observe(&self, event: ObservationEvent) {
        if let Ok(mut events) = self.events.lock() {
            events.push(event);
        }
    }
}
fn event(method: &str, params: Value) -> Event {
    Event {
        method: method.to_owned(),
        params: params.as_object().cloned().unwrap_or_default(),
    }
}
fn outputs(capture: &Capture) -> Result<Vec<(String, String)>> {
    Ok(capture
        .events
        .lock()
        .map_err(|_| Failure::new(ErrorCode::Native, "Fixture poisoned"))?
        .iter()
        .filter_map(|value| match value {
            ObservationEvent::Output { id, text, .. } => Some((id.clone(), text.clone())),
            _ => None,
        })
        .collect())
}

#[test]
fn native_streaming_deduplicates_utf16_prefixes_but_offsets_are_utf8_bytes_and_no_thinking_is_forwarded()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let hooks = Arc::new(Capture::default());
    let observer = Observer::new(Arc::clone(&hooks));
    for delta in ["hello ", "😀"] {
        observer.event(
            &event(
                "item/agentMessage/delta",
                json!({"threadId":"session","itemId":"item","delta":delta}),
            ),
            "session",
        )?;
    }
    observer.event(&event("item/completed", json!({"threadId":"session","item":{"id":"item","type":"agentMessage","text":"hello 😀 world"}})), "session")?;
    observer.event(
        &event(
            "item/reasoning/textDelta",
            json!({"threadId":"session","itemId":"thinking","delta":"private chain of thought"}),
        ),
        "session",
    )?;
    observer.event(&event("item/completed", json!({"threadId":"session","item":{"id":"thinking","type":"reasoning","text":"private reasoning"}})), "session")?;
    observer.event(
        &event(
            "item/agentMessage/delta",
            json!({"threadId":"other","itemId":"private","delta":"another session"}),
        ),
        "session",
    )?;
    assert_eq!(
        outputs(&hooks)?,
        [
            ("item:0".to_owned(), "hello ".to_owned()),
            ("item:6".to_owned(), "😀".to_owned()),
            ("item:10".to_owned(), " world".to_owned())
        ]
    );
    Ok(())
}

#[test]
fn complete_output_that_does_not_match_stream_is_preserved_and_large_file_changes_are_not_approval_limited()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let hooks = Arc::new(Capture::default());
    let observer = Observer::new(Arc::clone(&hooks));
    observer.event(
        &event(
            "item/agentMessage/delta",
            json!({"threadId":"session","itemId":"item","delta":"old"}),
        ),
        "session",
    )?;
    observer.event(&event("item/completed", json!({"threadId":"session","item":{"id":"item","type":"agentMessage","text":"replacement"}})), "session")?;
    let changes = json!([{"path":"report.txt","diff":"x".repeat(100_000)}]);
    assert!(
        observer
            .event(
                &event(
                    "item/started",
                    json!({"threadId":"session","item":{"id":"file","type":"fileChange"}})
                ),
                "session"
            )
            .is_err(),
        "Started observations also validate their exact native data without an approval text-size limit"
    );
    observer.event(&event("item/completed", json!({"threadId":"session","item":{"id":"file","type":"fileChange","changes":changes}})), "session")?;
    let output = outputs(&hooks)?;
    assert_eq!(output[1].1, "replacement");
    assert_eq!(serde_json::from_str::<Value>(&output[2].1)?, changes);
    Ok(())
}

#[test]
fn observations_expose_exact_activity_waiting_and_failure_with_strict_flags_and_bounded_error()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let hooks = Arc::new(Capture::default());
    let observer = Observer::new(Arc::clone(&hooks));
    observer.configure(&json!({"model":"chosen","features":{"default_mode_request_user_input":true}}), &json!({"model":"chosen","reasoningEffort":"high","sandbox":{"type":"readOnly"},"approvalPolicy":"never"}), Some("native version"))?;
    for (kind, flags) in [
        ("idle", json!(null)),
        ("active", json!([])),
        ("active", json!(["waitingOnApproval"])),
        ("active", json!(["waitingOnUserInput"])),
    ] {
        observer.event(
            &event(
                "thread/status/changed",
                json!({"threadId":"session","status":{"type":kind,"activeFlags":flags}}),
            ),
            "session",
        )?;
    }
    observer.event(&event("turn/completed", json!({"threadId":"session","turn":{"status":"failed","error":{"message":"😀".repeat(3000)}}})), "session")?;
    assert!(observer.event(&event("thread/status/changed", json!({"threadId":"session","status":{"type":"active","activeFlags":["invented"]}})), "session").is_err());
    let events = hooks.events.lock().map_err(|_| "Events")?;
    let states = events
        .iter()
        .filter_map(|event| match event {
            ObservationEvent::State { state, .. } => Some(*state),
            _ => None,
        })
        .collect::<Vec<_>>();
    assert_eq!(
        states,
        [
            State::Idle,
            State::Working,
            State::WaitingApproval,
            State::WaitingAnswer,
            State::Failed
        ]
    );
    let last = events.last().ok_or("Last state")?;
    if let ObservationEvent::State {
        settings,
        error_message,
        ..
    } = last
    {
        assert!(settings.iter().any(|setting| setting.name == "model"
            && setting.configured.as_deref() == Some("chosen")
            && setting.effective.as_deref() == Some("chosen")));
        let message = error_message.as_deref().ok_or("Failure text")?;
        assert_eq!(message, "😀".repeat(1000));
        assert_eq!(message.len(), 4000);
        assert!(crossfire_contracts::validation::plain_text(&json!(message), 4000).is_ok());
    }
    Ok(())
}

fn approval() -> Request {
    Request { id: RequestId::Text("request".to_owned()), method: "item/commandExecution/requestApproval".to_owned(), params: json!({"threadId":"session","turnId":"turn","itemId":"item","command":"command","cwd":"/workspace","availableDecisions":["accept","decline"]}).as_object().cloned().unwrap_or_default() }
}

#[tokio::test]
async fn permission_decisions_only_report_response_after_native_write_and_never_accept_unoffered_choices()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let hooks = Arc::new(Capture {
        answer: Mutex::new(Some(json!({"decision":"accept"}))),
        ..Capture::default()
    });
    let callbacks = SessionCallbacks::new(
        Arc::clone(&hooks),
        Some("session"),
        CancellationToken::new(),
    );
    let request = approval();
    assert_eq!(
        callbacks
            .decision(&request, CancellationToken::new())
            .await?,
        json!({"decision":"accept"})
    );
    assert!(hooks.responded.lock().map_err(|_| "Responses")?.is_empty());
    callbacks.responded(&request);
    callbacks.responded(&request);
    assert_eq!(hooks.responded.lock().map_err(|_| "Responses")?.len(), 1);
    *hooks.answer.lock().map_err(|_| "Answer")? = Some(json!({"decision":"acceptForSession"}));
    assert!(
        callbacks
            .decision(&request, CancellationToken::new())
            .await
            .is_err()
    );
    Ok(())
}

#[tokio::test]
async fn lost_owner_answer_denies_permission_but_cancellation_never_sends_an_answer()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let callbacks = SessionCallbacks::new(
        Arc::new(Capture::default()),
        Some("session"),
        CancellationToken::new(),
    );
    assert_eq!(
        callbacks
            .decision(&approval(), CancellationToken::new())
            .await?,
        json!({"decision":"decline"})
    );
    let hooks = Arc::new(Capture {
        answer: Mutex::new(Some(json!({"decision":"accept"}))),
        cancel: true,
        ..Capture::default()
    });
    let callbacks = SessionCallbacks::new(
        Arc::clone(&hooks),
        Some("session"),
        CancellationToken::new(),
    );
    assert!(
        callbacks
            .decision(&approval(), CancellationToken::new())
            .await
            .is_err()
    );
    callbacks.responded(&approval());
    assert!(hooks.responded.lock().map_err(|_| "Responses")?.is_empty());
    Ok(())
}

#[test]
fn malformed_native_activity_fails_the_connection_instead_of_reporting_a_guessed_state()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let callbacks = SessionCallbacks::new(
        Arc::new(Capture::default()),
        Some("session"),
        CancellationToken::new(),
    );
    callbacks.event(event(
        "thread/status/changed",
        json!({"threadId":"session","status":{"type":"active","activeFlags":["unknown"]}}),
    ));
    assert!(callbacks.lifetime().is_cancelled());
    assert!(callbacks.failure()?.is_some());
    Ok(())
}
