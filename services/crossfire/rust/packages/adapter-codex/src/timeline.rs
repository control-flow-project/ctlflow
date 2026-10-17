use crate::{
    control::{self, Latest},
    protocol::{Protocol, Reply},
    session::Session,
};
use crossfire_contracts::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashSet;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Boundary {
    pub position: i64,
    pub key: String,
}

pub struct Entry {
    pub value: Value,
    pub boundary: Boundary,
}
pub struct Page {
    pub entries: Vec<Entry>,
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReceiptStatus {
    Received,
    Pending,
    Interrupted,
    Missing,
    Unavailable,
}
pub struct Receipt {
    pub status: ReceiptStatus,
    pub boundary: Option<Boundary>,
}

pub enum Scan {
    Receipt(Receipt),
    TimelineUnavailable,
}

pub struct Capture {
    pub boundary: Option<Boundary>,
    pub initializing: bool,
}

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}

pub fn page(value: Value, maximum: usize) -> Result<Page> {
    let Value::Object(mut value) = value else {
        return Err(invalid("Invalid Codex input history page"));
    };
    let Some(Value::Array(data)) = value.remove("data") else {
        return Err(invalid("Invalid Codex input history page"));
    };
    if data.len() > maximum {
        return Err(invalid("Invalid Codex input history page"));
    }
    let cursor = match value.get("nextCursor") {
        Some(Value::Null) => None,
        Some(Value::String(value)) if !value.is_empty() && !data.is_empty() => {
            Some(value.to_owned())
        }
        _ => return Err(invalid("Invalid Codex input history cursor")),
    };
    let mut entries = Vec::with_capacity(data.len());
    for row in data.into_iter().rev() {
        let Value::Object(row) = row else {
            return Err(invalid("Invalid Codex input history entry"));
        };
        let position = validation::integer(
            row.get("position")
                .ok_or_else(|| invalid("Invalid Codex input history position"))?,
            0,
            validation::SAFE_INTEGER,
        )?;
        let kind = row
            .get("type")
            .and_then(Value::as_str)
            .filter(|value| ["item", "realtime", "turnStarted", "turnCompleted"].contains(value))
            .ok_or_else(|| invalid("Invalid Codex turn history entry"))?;
        let turn = row.get("turnId").and_then(Value::as_str);
        if kind != "realtime" && !turn.is_some_and(|value| !value.is_empty()) {
            return Err(invalid("Invalid Codex turn history identity"));
        }
        let item = if matches!(kind, "item" | "realtime") {
            let item = row
                .get("item")
                .and_then(Value::as_object)
                .ok_or_else(|| invalid("Invalid Codex history item"))?;
            let id = item
                .get("id")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| invalid("Invalid Codex history item"))?;
            if !item.get("type").is_some_and(Value::is_string) {
                return Err(invalid("Invalid Codex history item"));
            }
            Some(id)
        } else {
            None
        };
        if kind == "turnCompleted"
            && !row
                .get("status")
                .and_then(Value::as_str)
                .is_some_and(|value| ["completed", "interrupted", "failed"].contains(&value))
        {
            return Err(invalid("Invalid Codex turn completion"));
        }
        let key = serde_json::to_string(&json!([position, kind, turn, item]))
            .map_err(|_| invalid("Invalid native history boundary"))?;
        entries.push(Entry {
            value: Value::Object(row),
            boundary: Boundary { position, key },
        });
    }
    Ok(Page { entries, cursor })
}

async fn request<P: Protocol>(
    session: &Session<P>,
    maximum: usize,
    cursor: Option<&str>,
    cancellation: CancellationToken,
) -> Result<Reply> {
    if !(1..=100).contains(&maximum) {
        return Err(invalid("Invalid native history page bound"));
    }
    let mut parameters = json!({"threadId":session.id,"limit":maximum});
    if let Some(cursor) = cursor {
        parameters["cursor"] = json!(cursor);
    }
    session
        .protocol
        .request("thread/timeline/list", &parameters, cancellation)
        .await
}

pub async fn read<P: Protocol>(
    session: &Session<P>,
    maximum: usize,
    cursor: Option<&str>,
    cancellation: CancellationToken,
) -> Result<Page> {
    match request(session, maximum, cursor, cancellation).await? {
        Reply::Value(value) => page(value, maximum),
        Reply::Error(_) => Err(invalid("Cannot inspect native Codex input history")),
    }
}

pub async fn capture<P: Protocol>(
    session: &Session<P>,
    cancellation: CancellationToken,
) -> Result<Capture> {
    match request(session, 1, None, cancellation.clone()).await? {
        Reply::Value(value) => Ok(Capture {
            boundary: page(value, 1)?
                .entries
                .first()
                .map(|value| value.boundary.clone()),
            initializing: false,
        }),
        Reply::Error(error) if error.code == -32601 => {
            match control::latest(session, cancellation).await? {
                Latest::BeforeFirstInput => Ok(Capture {
                    boundary: None,
                    initializing: true,
                }),
                Latest::Turn(_) => Err(invalid(
                    "Native input history is unavailable for a materialized session",
                )),
            }
        }
        Reply::Error(_) => Err(invalid("Cannot capture native Codex input history")),
    }
}

pub fn is_receipt(value: &Value, text: &str, id: &str) -> Result<bool> {
    let item = value
        .as_object()
        .ok_or_else(|| invalid("Invalid Codex item"))?;
    let kind = item
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Invalid Codex item"))?;
    if kind != "userMessage" || item.get("clientId").and_then(Value::as_str) != Some(id) {
        return Ok(false);
    }
    if !item
        .get("id")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty())
    {
        return Err(invalid("Invalid Codex input receipt"));
    }
    let content = item
        .get("content")
        .and_then(Value::as_array)
        .filter(|value| value.len() == 1)
        .and_then(|value| value[0].as_object())
        .ok_or_else(|| invalid("Invalid Codex input receipt"))?;
    if content.get("type").and_then(Value::as_str) != Some("text")
        || content.get("text").and_then(Value::as_str) != Some(text)
    {
        return Err(invalid(
            "Codex input receipt differs from the submitted message",
        ));
    }
    Ok(true)
}

pub async fn receipt<P: Protocol>(
    session: &Session<P>,
    turn: Option<&str>,
    text: &str,
    id: &str,
    boundary: Option<&Boundary>,
    cancellation: CancellationToken,
) -> Result<Receipt> {
    match scan(session, turn, text, id, boundary, cancellation).await? {
        Scan::Receipt(receipt) => Ok(receipt),
        Scan::TimelineUnavailable => Err(invalid("Cannot inspect native Codex input history")),
    }
}

pub async fn scan<P: Protocol>(
    session: &Session<P>,
    turn: Option<&str>,
    text: &str,
    id: &str,
    boundary: Option<&Boundary>,
    cancellation: CancellationToken,
) -> Result<Scan> {
    let mut cursor = None;
    let mut visited = HashSet::new();
    let mut seen = HashSet::new();
    let mut completion = None;
    let mut started = false;
    let mut newest = boundary.cloned();
    let mut position = i64::MAX;
    for count in 0..100 {
        let page = match request(session, 100, cursor.as_deref(), cancellation.clone()).await? {
            Reply::Value(value) => page(value, 100)?,
            Reply::Error(error) if error.code == -32601 => return Ok(Scan::TimelineUnavailable),
            Reply::Error(_) => return Err(invalid("Cannot inspect native Codex input history")),
        };
        if count == 0 {
            newest = page.entries.first().map(|value| value.boundary.clone());
        }
        for value in &page.entries {
            if value.boundary.position > position || !seen.insert(value.boundary.key.clone()) {
                return Err(invalid("Invalid Codex input history order"));
            }
            position = value.boundary.position;
        }
        for value in page.entries {
            if boundary.is_some_and(|boundary| boundary.key == value.boundary.key) {
                return Ok(Scan::Receipt(Receipt {
                    status: completion.unwrap_or(ReceiptStatus::Pending),
                    boundary: newest,
                }));
            }
            if boundary.is_some_and(|boundary| value.boundary.position < boundary.position) {
                return Err(invalid(
                    "Codex input history lost its verification boundary",
                ));
            }
            let entry = &value.value;
            if entry["type"] == "item" && is_receipt(&entry["item"], text, id)? {
                if turn.is_some_and(|turn| entry["turnId"].as_str() != Some(turn)) {
                    return Err(invalid("Codex input receipt belongs to a different turn"));
                }
                return Ok(Scan::Receipt(Receipt {
                    status: ReceiptStatus::Received,
                    boundary: newest,
                }));
            }
            if turn.is_none() || entry["turnId"].as_str() != turn {
                continue;
            }
            if entry["type"] == "turnCompleted" {
                completion = Some(if entry["status"] == "interrupted" {
                    ReceiptStatus::Interrupted
                } else {
                    ReceiptStatus::Missing
                });
            } else if entry["type"] == "turnStarted" {
                started = true;
            }
        }
        let Some(next) = page.cursor else {
            if boundary.is_some() {
                return Err(invalid(
                    "Codex input history lost its verification boundary",
                ));
            }
            return Ok(Scan::Receipt(Receipt {
                status: if started {
                    completion.unwrap_or(ReceiptStatus::Pending)
                } else {
                    ReceiptStatus::Unavailable
                },
                boundary: if started { newest } else { None },
            }));
        };
        if !visited.insert(next.clone()) {
            return Err(invalid("Invalid Codex input history cursor"));
        }
        cursor = Some(next);
    }
    Err(invalid(
        "Codex input history exceeds the verification bound; read positions were not advanced",
    ))
}
