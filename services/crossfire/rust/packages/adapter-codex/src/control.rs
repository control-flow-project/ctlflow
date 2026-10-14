use crate::{
    protocol::{Protocol, Reply},
    session::{self, Session, Status},
};
use crossfire_adapter_runtime::clock::{self, Clock};
use crossfire_agent_core::runtime::InterruptResult;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::collections::HashSet;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnStatus {
    Working,
    Completed,
    Interrupted,
    Failed,
}

pub struct Turn {
    pub id: String,
    pub status: TurnStatus,
}

pub enum Latest {
    Turn(Option<Turn>),
    BeforeFirstInput,
}

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}

fn status(value: &Value) -> Result<TurnStatus> {
    match value.as_str() {
        Some("inProgress") => Ok(TurnStatus::Working),
        Some("completed") => Ok(TurnStatus::Completed),
        Some("interrupted") => Ok(TurnStatus::Interrupted),
        Some("failed") => Ok(TurnStatus::Failed),
        _ => Err(invalid("Invalid Codex turn status")),
    }
}

pub async fn latest<P: Protocol>(
    session: &Session<P>,
    cancellation: CancellationToken,
) -> Result<Latest> {
    let response = match session.protocol.request(
        "thread/turns/list",
        &json!({"threadId":session.id,"limit":1,"sortDirection":"desc","itemsView":"notLoaded"}),
        cancellation,
    )
    .await? {
        Reply::Value(value) => value,
        Reply::Error(error) if error.unmaterialized(&session.id) => return Ok(Latest::BeforeFirstInput),
        Reply::Error(_) => return Err(invalid("Cannot inspect the selected Codex turn")),
    };
    let data = response
        .get("data")
        .and_then(Value::as_array)
        .filter(|value| value.len() <= 1)
        .ok_or_else(|| invalid("Invalid Codex turn page"))?;
    data.first()
        .map(|value| {
            let id = value
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| invalid("Invalid Codex turn identity"))?;
            Ok(Turn {
                id: id.to_owned(),
                status: status(
                    value
                        .get("status")
                        .ok_or_else(|| invalid("Invalid Codex turn status"))?,
                )?,
            })
        })
        .transpose()
        .map(Latest::Turn)
}

pub async fn active<P: Protocol>(
    session: &Session<P>,
    cancellation: CancellationToken,
) -> Result<Option<String>> {
    match session.current(cancellation.clone()).await?.status {
        Status::Idle => Ok(None),
        Status::Active => match latest(session, cancellation.clone()).await? {
            Latest::Turn(turn) => Ok(turn
                .filter(|value| value.status == TurnStatus::Working)
                .map(|value| value.id)),
            Latest::BeforeFirstInput
                if session.current(cancellation).await?.status == Status::Idle =>
            {
                Ok(None)
            }
            Latest::BeforeFirstInput => Err(invalid("The active Codex turn cannot be established")),
        },
        Status::NotLoaded => Err(invalid(
            "The selected native session is not loaded for turn inspection",
        )),
    }
}

pub async fn turn_status<P: Protocol>(
    session: &Session<P>,
    id: &str,
    cancellation: CancellationToken,
) -> Result<TurnStatus> {
    let mut cursor = None;
    let mut visited = HashSet::new();
    for _ in 0..100 {
        let mut parameters = json!({"threadId":session.id,"limit":100,"sortDirection":"desc","itemsView":"notLoaded"});
        if let Some(cursor) = &cursor {
            parameters["cursor"] = json!(cursor);
        }
        let response = session::value(
            session.protocol.as_ref(),
            "thread/turns/list",
            &parameters,
            cancellation.clone(),
        )
        .await?;
        let data = response
            .get("data")
            .and_then(Value::as_array)
            .filter(|value| value.len() <= 100)
            .ok_or_else(|| invalid("Invalid Codex turn page"))?;
        for turn in data {
            if turn.get("id").and_then(Value::as_str) == Some(id) {
                return status(
                    turn.get("status")
                        .ok_or_else(|| invalid("Invalid Codex turn status"))?,
                );
            }
        }
        match response.get("nextCursor") {
            Some(Value::Null) => break,
            Some(Value::String(value))
                if !value.is_empty() && !data.is_empty() && visited.insert(value.to_owned()) =>
            {
                cursor = Some(value.to_owned());
            }
            _ => return Err(invalid("Invalid Codex turn cursor")),
        }
    }
    Err(invalid(
        "Cannot prove the captured Codex turn status; refusing replacement input",
    ))
}

pub async fn interrupt<P: Protocol>(
    session: &Session<P>,
    id: &str,
    recovery: bool,
    clock: &impl Clock,
    timeout_ms: u64,
    cancellation: CancellationToken,
) -> Result<InterruptResult> {
    if !(100..=300_000).contains(&timeout_ms) {
        return Err(invalid("Invalid native cancellation deadline"));
    }
    match session.current(cancellation.clone()).await?.status {
        Status::Idle => return Ok(InterruptResult::Inactive),
        Status::NotLoaded => {
            return Err(invalid(
                "The selected native session is not loaded for interruption",
            ));
        }
        Status::Active => {}
    }
    let result = |status| {
        if status == TurnStatus::Interrupted {
            InterruptResult::Interrupted
        } else {
            InterruptResult::Inactive
        }
    };
    let status = turn_status(session, id, cancellation.clone()).await?;
    if status != TurnStatus::Working {
        return Ok(result(status));
    }
    if recovery {
        return Err(invalid(
            "Previous cancellation is uncertain and the captured turn is still active; inspect it before restarting the listener",
        ));
    }
    let response = session
        .protocol
        .request(
            "turn/interrupt",
            &json!({"threadId":session.id,"turnId":id}),
            cancellation.clone(),
        )
        .await;
    if !response
        .as_ref()
        .is_ok_and(|value| matches!(value, Reply::Value(_)))
    {
        clock::check(&cancellation)?;
        if turn_status(session, id, cancellation.clone()).await? == TurnStatus::Working {
            return Err(invalid("Native Codex turn interruption failed"));
        }
    }
    let deadline = clock.now().saturating_add(timeout_ms);
    loop {
        let status = turn_status(session, id, cancellation.clone()).await?;
        if status != TurnStatus::Working {
            return Ok(result(status));
        }
        if clock.now() >= deadline {
            return Err(invalid(
                "Codex cancellation remains uncertain; refusing replacement input",
            ));
        }
        clock.wait(100, cancellation.clone()).await?;
    }
}
