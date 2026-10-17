mod support;
use crossfire_adapter_codex::{connection::CodexConnection, control, input::Input, timeline};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_runtime::journal::{self, NativeMessage};
use crossfire_agent_core::runtime::ObservationEvent;
use serde_json::json;
use std::sync::Arc;
use support::{Answer, Native, Observations, empty, idle, state};
use tokio_util::sync::CancellationToken;

#[test]
fn canonical_journal_input_preserves_required_fields_and_rejects_other_representations()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let value = json!({"turn":null,"text":"original","messageId":"message","boundary":null,"initializing":false});
    let input: Input = serde_json::from_value(value.clone())?;
    input.validate()?;
    assert_eq!(serde_json::to_value(&input)?, value);
    for key in ["turn", "text", "messageId", "boundary", "initializing"] {
        let mut omitted = value.clone();
        omitted.as_object_mut().ok_or("Object")?.remove(key);
        assert!(
            serde_json::from_value::<Input>(omitted).is_err(),
            "Required native field {key}"
        );
    }
    let mut unknown = value.clone();
    unknown["legacy"] = json!(true);
    assert!(serde_json::from_value::<Input>(unknown).is_err());
    let mut nested = value;
    nested["resumption"] = json!({"turn":null,"text":"notice","messageId":"crossfire-resume-notice","boundary":null,"initializing":false});
    let restored: Input = serde_json::from_value(nested.clone())?;
    restored.validate()?;
    assert_eq!(serde_json::to_value(restored)?, nested);
    Ok(())
}

#[tokio::test]
async fn delivery_records_before_submission_and_requires_exact_receipt_without_resubmitting_confirmed_input()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    PrivateDirectory::open(directory.path(), false)?;
    let receipt = directory.path().join("receipt");
    let session = Native::session(
        directory.path(),
        vec![
            ("thread/read", idle(directory.path())),
            ("thread/timeline/list", empty()),
            ("turn/start", Answer::Start),
            ("thread/read", idle(directory.path())),
            ("thread/timeline/list", Answer::Receipt),
        ],
        Some(receipt.clone()),
        None,
    );
    let connection = CodexConnection::open(
        Arc::clone(&session),
        Arc::new(Observations::default()),
        &receipt,
        100,
        1000,
    )?;
    connection
        .deliver("original", "message", CancellationToken::new(), None)
        .await?;
    connection
        .deliver("original", "message", CancellationToken::new(), None)
        .await?;
    assert!(
        connection
            .deliver("changed", "message", CancellationToken::new(), None)
            .await
            .is_err()
    );
    let recorded = journal::read::<Input>(&receipt, "session")?;
    assert!(recorded.pending.is_none());
    assert_eq!(recorded.confirmed.len(), 1);
    assert_eq!(
        session
            .protocol
            .calls
            .lock()
            .map_err(|_| "Calls")?
            .iter()
            .filter(|(method, _)| method == "turn/start")
            .count(),
        1
    );
    connection.acknowledge(&["message".to_owned()])?;
    assert!(!connection.unsettled()?);
    connection.close().await?;
    Ok(())
}

#[tokio::test]
async fn lost_submission_reply_is_recovered_from_native_history_without_starting_another_turn()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let receipt = directory.path().join("receipt");
    let original = Native::session(
        directory.path(),
        vec![
            ("thread/read", idle(directory.path())),
            ("thread/timeline/list", empty()),
            ("turn/start", Answer::LostResponse),
        ],
        Some(receipt.clone()),
        None,
    );
    let connection = CodexConnection::open(
        Arc::clone(&original),
        Arc::new(Observations::default()),
        &receipt,
        100,
        1000,
    )?;
    assert!(
        connection
            .deliver(
                "origin attribution and message",
                "message",
                CancellationToken::new(),
                None
            )
            .await
            .is_err()
    );
    connection.close().await?;
    let resumed = Native::session(
        directory.path(),
        vec![
            ("thread/read", idle(directory.path())),
            ("thread/timeline/list", Answer::Receipt),
        ],
        Some(receipt.clone()),
        Some(Arc::clone(&original.protocol.calls)),
    );
    let connection = CodexConnection::open(
        Arc::clone(&resumed),
        Arc::new(Observations::default()),
        &receipt,
        100,
        1000,
    )?;
    assert!(
        connection
            .recover(
                "origin attribution and message",
                "message",
                CancellationToken::new()
            )
            .await?
    );
    assert_eq!(
        resumed
            .protocol
            .calls
            .lock()
            .map_err(|_| "Calls")?
            .iter()
            .filter(|(method, _)| method == "turn/start")
            .count(),
        1
    );
    connection.close().await?;
    Ok(())
}

#[tokio::test]
async fn unverifiable_input_after_restart_becomes_explicit_last_message_context_with_its_own_exact_receipt()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let receipt = directory.path().join("receipt");
    let original = Native::session(
        directory.path(),
        vec![
            ("thread/read", idle(directory.path())),
            ("thread/timeline/list", empty()),
            ("turn/start", Answer::LostResponse),
        ],
        Some(receipt.clone()),
        None,
    );
    let connection = CodexConnection::open(
        Arc::clone(&original),
        Arc::new(Observations::default()),
        &receipt,
        100,
        1000,
    )?;
    let text = "[From room !original:example, sender @human:example]\nContinue the original task.";
    assert!(
        connection
            .deliver(text, "message", CancellationToken::new(), None)
            .await
            .is_err()
    );
    connection.close().await?;
    let session = Native::session(
        directory.path(),
        vec![
            ("thread/read", idle(directory.path())),
            ("thread/timeline/list", empty()),
            ("thread/read", idle(directory.path())),
            ("thread/timeline/list", empty()),
            ("turn/start", Answer::Start),
            ("thread/read", idle(directory.path())),
            ("thread/timeline/list", Answer::Receipt),
        ],
        Some(receipt.clone()),
        Some(Arc::clone(&original.protocol.calls)),
    );
    let observations = Arc::new(Observations::default());
    let connection = CodexConnection::open(
        Arc::clone(&session),
        Arc::clone(&observations),
        &receipt,
        100,
        1000,
    )?;
    assert!(
        connection
            .recover(text, "message", CancellationToken::new())
            .await?
    );
    {
        let calls = session.protocol.calls.lock().map_err(|_| "Calls")?;
        let notices = calls
            .iter()
            .filter(|(method, _)| method == "turn/start")
            .collect::<Vec<_>>();
        assert_eq!(notices.len(), 2);
        assert_ne!(
            notices[0].1["clientUserMessageId"],
            notices[1].1["clientUserMessageId"]
        );
        let notice = notices[1].1["input"][0]["text"]
            .as_str()
            .ok_or("Notice text")?;
        assert!(notice.contains("old execution is not running"));
        assert!(notice.contains("AGENTS.md"));
        assert!(notice.contains("Do not repeat completed actions"));
        assert!(!notice.contains(directory.path().to_str().ok_or("Fixture path")?));
        let files = std::fs::read_dir(directory.path().join("resume-input"))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        assert_eq!(files.len(), 1);
        assert_eq!(std::fs::read_to_string(files[0].path())?, text);
        assert_eq!(
            observations
                .0
                .lock()
                .map_err(|_| "Observations")?
                .iter()
                .filter(|event| matches!(event, ObservationEvent::Output { .. }))
                .count(),
            1
        );
    }
    connection.close().await?;
    Ok(())
}

#[tokio::test]
async fn wrong_receipt_preserves_original_input_and_never_advances_confirmation()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let receipt = directory.path().join("receipt");
    let session = Native::session(
        directory.path(),
        vec![
            ("thread/read", idle(directory.path())),
            ("thread/timeline/list", empty()),
            ("turn/start", Answer::Start),
            ("thread/read", idle(directory.path())),
            (
                "thread/timeline/list",
                Answer::Value(
                    json!({"data":[{"position":1,"type":"item","turnId":"turn","item":{"type":"userMessage","id":"item","clientId":"message","content":[{"type":"text","text":"changed"}]}}],"nextCursor":null}),
                ),
            ),
        ],
        Some(receipt.clone()),
        None,
    );
    let connection = CodexConnection::open(
        session,
        Arc::new(Observations::default()),
        &receipt,
        100,
        1000,
    )?;
    assert!(
        connection
            .deliver("original", "message", CancellationToken::new(), None)
            .await
            .is_err()
    );
    let saved = journal::read::<Input>(&receipt, "session")?;
    assert_eq!(saved.pending.ok_or("Pending input")?.text(), "original");
    assert!(saved.confirmed.is_empty());
    connection.close().await?;
    Ok(())
}

#[tokio::test]
async fn native_unmaterialized_state_is_recognized_only_by_exact_code_message_and_current_state()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let message = "thread session is not materialized yet; thread/turns/list is unavailable before first user message";
    let session = Native::session(
        directory.path(),
        vec![
            (
                "thread/timeline/list",
                Answer::Error(-32601, "Method not found"),
            ),
            ("thread/turns/list", Answer::Error(-32600, message)),
        ],
        None,
        None,
    );
    let capture = timeline::capture(&session, CancellationToken::new()).await?;
    assert!(capture.initializing && capture.boundary.is_none());
    let idle_race = Native::session(
        directory.path(),
        vec![
            ("thread/read", state(directory.path(), "active")),
            ("thread/turns/list", Answer::Error(-32600, message)),
            ("thread/read", idle(directory.path())),
        ],
        None,
        None,
    );
    assert!(
        control::active(&idle_race, CancellationToken::new())
            .await?
            .is_none()
    );
    for (code, text) in [(-32600, "Something else"), (-32601, message)] {
        let rejected = Native::session(
            directory.path(),
            vec![
                ("thread/read", state(directory.path(), "active")),
                ("thread/turns/list", Answer::Error(code, text)),
            ],
            None,
            None,
        );
        assert!(
            control::active(&rejected, CancellationToken::new())
                .await
                .is_err()
        );
    }
    let materialized = Native::session(
        directory.path(),
        vec![
            (
                "thread/timeline/list",
                Answer::Error(-32601, "Method not found"),
            ),
            ("thread/turns/list", empty()),
        ],
        None,
        None,
    );
    assert!(
        timeline::capture(&materialized, CancellationToken::new())
            .await
            .is_err()
    );
    Ok(())
}
