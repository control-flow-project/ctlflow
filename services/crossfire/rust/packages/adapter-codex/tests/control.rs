use crossfire_adapter_codex::{
    control,
    protocol::{Protocol, Reply},
    session::Session,
    timeline,
};
use crossfire_adapter_runtime::clock::Clock;
use crossfire_agent_core::runtime::{Approval, InterruptResult};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio_util::sync::CancellationToken;

struct Native {
    responses: Mutex<VecDeque<(&'static str, Value)>>,
    calls: Mutex<Vec<String>>,
    cancellation: CancellationToken,
}
impl Protocol for Native {
    fn lifetime(&self) -> CancellationToken {
        self.cancellation.clone()
    }
    async fn request(
        &self,
        method: &str,
        parameters: &Value,
        _cancellation: CancellationToken,
    ) -> Result<Reply> {
        assert_eq!(parameters["threadId"], "session");
        self.calls
            .lock()
            .map_err(|_| Failure::new(ErrorCode::Native, "Fixture poisoned"))?
            .push(method.to_owned());
        let (expected, response) = self
            .responses
            .lock()
            .map_err(|_| Failure::new(ErrorCode::Native, "Fixture poisoned"))?
            .pop_front()
            .ok_or_else(|| Failure::new(ErrorCode::Native, "Unexpected fixture request"))?;
        assert_eq!(method, expected);
        Ok(Reply::Value(response))
    }
    async fn notify(&self, _method: &str, _cancellation: CancellationToken) -> Result<()> {
        Ok(())
    }
    async fn close(&self) -> Result<()> {
        self.cancellation.cancel();
        Ok(())
    }
}

struct ControlledClock(AtomicU64);
impl Clock for ControlledClock {
    fn now(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
    async fn wait(&self, milliseconds: u64, cancellation: CancellationToken) -> Result<()> {
        crossfire_adapter_runtime::clock::check(&cancellation)?;
        self.0.fetch_add(milliseconds, Ordering::SeqCst);
        Ok(())
    }
}

fn fixture_session(
    directory: &std::path::Path,
    responses: Vec<(&'static str, Value)>,
) -> Session<Native> {
    Session {
        id: "session".to_owned(),
        workspace: directory.to_owned(),
        approval: Approval::None,
        model: "fixture".to_owned(),
        effort: "high".to_owned(),
        user_agent: None,
        protocol: Arc::new(Native {
            responses: Mutex::new(responses.into()),
            calls: Mutex::new(Vec::new()),
            cancellation: CancellationToken::new(),
        }),
    }
}
fn thread(directory: &std::path::Path, status: &str) -> Value {
    json!({"thread":{"id":"session","cwd":directory,"status":{"type":status},"canAcceptDirectInput":true}})
}
fn turn(status: &str) -> Value {
    json!({"data":[{"id":"turn","status":status}],"nextCursor":null})
}

#[tokio::test]
async fn fresh_idle_execution_has_no_old_running_turn_to_inspect_or_interrupt()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let session = fixture_session(
        directory.path(),
        vec![
            ("thread/read", thread(directory.path(), "idle")),
            ("thread/read", thread(directory.path(), "idle")),
        ],
    );
    assert!(
        control::active(&session, CancellationToken::new())
            .await?
            .is_none()
    );
    assert_eq!(
        control::interrupt(
            &session,
            "old-turn",
            false,
            &ControlledClock(AtomicU64::new(0)),
            300,
            CancellationToken::new()
        )
        .await?,
        InterruptResult::Inactive
    );
    assert_eq!(
        *session
            .protocol
            .calls
            .lock()
            .map_err(|_| "Fixture poisoned")?,
        ["thread/read", "thread/read"]
    );
    Ok(())
}

#[tokio::test]
async fn active_interruption_uses_exact_native_turn_and_observes_its_completion()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let session = fixture_session(
        directory.path(),
        vec![
            ("thread/read", thread(directory.path(), "active")),
            ("thread/turns/list", turn("inProgress")),
            ("turn/interrupt", json!({})),
            ("thread/turns/list", turn("inProgress")),
            ("thread/turns/list", turn("interrupted")),
        ],
    );
    let clock = ControlledClock(AtomicU64::new(0));
    assert_eq!(
        control::interrupt(
            &session,
            "turn",
            false,
            &clock,
            300,
            CancellationToken::new()
        )
        .await?,
        InterruptResult::Interrupted
    );
    assert_eq!(clock.now(), 100);
    Ok(())
}

#[tokio::test]
async fn uncertain_interruption_or_wrong_workspace_never_authorizes_replacement_input()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let session = fixture_session(
        directory.path(),
        vec![
            ("thread/read", thread(directory.path(), "active")),
            ("thread/turns/list", turn("inProgress")),
        ],
    );
    assert!(
        control::interrupt(
            &session,
            "turn",
            true,
            &ControlledClock(AtomicU64::new(0)),
            300,
            CancellationToken::new()
        )
        .await
        .is_err()
    );
    assert!(
        !session
            .protocol
            .calls
            .lock()
            .map_err(|_| "Fixture poisoned")?
            .iter()
            .any(|value| value == "turn/interrupt")
    );
    let other = tempfile::tempdir()?;
    let foreign = fixture_session(
        directory.path(),
        vec![("thread/read", thread(other.path(), "active"))],
    );
    assert!(
        control::active(&foreign, CancellationToken::new())
            .await
            .is_err()
    );
    Ok(())
}

#[test]
fn timeline_receipts_require_exact_user_message_identity_content_and_structure()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let item = json!({"type":"userMessage","id":"native-item","clientId":"message","content":[{"type":"text","text":"original"}]});
    assert!(timeline::is_receipt(&item, "original", "message")?);
    assert!(timeline::is_receipt(&item, "changed", "message").is_err());
    assert!(!timeline::is_receipt(&item, "original", "another")?);
    let page = timeline::page(
        json!({"data":[{"position":1,"type":"turnStarted","turnId":"turn"},{"position":2,"type":"item","turnId":"turn","item":item}],"nextCursor":null}),
        100,
    )?;
    assert_eq!(page.entries.len(), 2);
    assert_eq!(page.entries[0].boundary.position, 2);
    assert!(timeline::page(json!({"data":[],"nextCursor":"invalid"}), 100).is_err());
    assert!(timeline::page(json!({"data":[{"position":-1,"type":"turnStarted","turnId":"turn"}],"nextCursor":null}),100).is_err());
    Ok(())
}

#[tokio::test]
async fn timeline_receipt_cannot_cross_a_turn_or_lose_its_prepublication_boundary()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let item = json!({"position":3,"type":"item","turnId":"turn","item":{"type":"userMessage","id":"item","clientId":"message","content":[{"type":"text","text":"original"}]}});
    let session = fixture_session(
        directory.path(),
        vec![(
            "thread/timeline/list",
            json!({"data":[item],"nextCursor":null}),
        )],
    );
    assert_eq!(
        timeline::receipt(
            &session,
            Some("turn"),
            "original",
            "message",
            None,
            CancellationToken::new()
        )
        .await?
        .status,
        timeline::ReceiptStatus::Received
    );
    let wrong = fixture_session(
        directory.path(),
        vec![(
            "thread/timeline/list",
            json!({"data":[item],"nextCursor":null}),
        )],
    );
    assert!(
        timeline::receipt(
            &wrong,
            Some("other"),
            "original",
            "message",
            None,
            CancellationToken::new()
        )
        .await
        .is_err()
    );
    let missing = fixture_session(
        directory.path(),
        vec![("thread/timeline/list", json!({"data":[],"nextCursor":null}))],
    );
    assert!(
        timeline::receipt(
            &missing,
            Some("turn"),
            "original",
            "message",
            Some(&timeline::Boundary {
                position: 2,
                key: "retained".to_owned()
            }),
            CancellationToken::new()
        )
        .await
        .is_err()
    );
    Ok(())
}
