use crate::protocol::{self, API, Protocol, Request};
const HISTORY_BYTES: usize = 64 * 1024 * 1024;
use crossfire_contracts::{operations::Method, origin::segment, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use tokio_util::sync::CancellationToken;

use crate::message_events::IMPORTANT;
pub struct Page {
    pub chunk: Vec<Value>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub requested_limit: usize,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub async fn joined(matrix: &impl Protocol, stop: CancellationToken) -> Result<BTreeSet<String>> {
    let response = protocol::request(
        matrix,
        &Request::new(Method::Get, format!("{API}/joined_rooms")),
        stop,
    )
    .await?;
    let rooms = check::list(
        response
            .get("joined_rooms")
            .ok_or_else(|| invalid("Native joined rooms are missing"))?,
        0,
        1000,
    )?;
    let parsed = rooms
        .iter()
        .map(crate::syntax::room_id)
        .collect::<Result<BTreeSet<_>>>()?;
    if parsed.len() != rooms.len() {
        return Err(invalid("Duplicate native joined-room identities"));
    }
    Ok(parsed)
}
fn token(value: Option<Value>) -> Result<Option<String>> {
    value
        .filter(|value| !value.is_null())
        .map(|value| check::text(&value, 1, 16384).map(str::to_owned))
        .transpose()
}
pub async fn history(
    matrix: &impl Protocol,
    room: &str,
    query: &BTreeMap<String, String>,
    requested: usize,
    stop: CancellationToken,
) -> Result<Page> {
    crate::syntax::room_id(&json!(room))?;
    if !(1..=100).contains(&requested) {
        return Err(invalid("Native history pages require 1–100 events"));
    }
    let mut limit = requested;
    loop {
        let mut input = Request::new(
            Method::Get,
            format!("{API}/rooms/{}/messages", segment(room)),
        );
        input.query = query.clone();
        input.query.insert("limit".to_owned(), limit.to_string());
        input.maximum_bytes = if limit == 1 {
            HISTORY_BYTES
        } else {
            1024 * 1024
        };
        let response = protocol::request(matrix, &input, stop.clone()).await;
        let mut body = match response {
            Ok(Value::Object(body)) => body,
            Ok(_) => return Err(invalid("Invalid native history page")),
            Err(error) if error.code == ErrorCode::BodyTooLarge && limit > 1 => {
                limit = (limit / 2).max(1);
                continue;
            }
            Err(error) if error.code == ErrorCode::BodyTooLarge => {
                return Err(Failure::new(
                    ErrorCode::Limit,
                    "A single native event exceeds 64 MiB; unread positions are unchanged",
                ));
            }
            Err(error) => return Err(error),
        };
        let chunk = match body.remove("chunk") {
            Some(Value::Array(chunk)) if chunk.len() <= limit => chunk,
            _ => return Err(invalid("Invalid native history event count")),
        };
        let start = token(body.remove("start"))?;
        let end = token(body.remove("end"))?;
        if !chunk.is_empty()
            && end
                .as_ref()
                .is_none_or(|end| query.get("from") == Some(end))
        {
            return Err(invalid("Native history cursor did not advance"));
        }
        return Ok(Page {
            chunk,
            start,
            end,
            requested_limit: limit,
        });
    }
}
pub async fn sync(
    matrix: &impl Protocol,
    since: Option<&str>,
    timeout: u32,
    stop: CancellationToken,
) -> Result<Value> {
    if timeout > 30000 {
        return Err(invalid("Native sync requires a bounded 30-second wait"));
    }
    if let Some(since) = since {
        check::text(&json!(since), 1, 16384)?;
    }
    let mut limit = 100;
    loop {
        let filter = json!({"presence":{"types":[]},"account_data":{"types":[]},"room":{"timeline":{"limit":limit,"types":IMPORTANT},"state":{"types":["m.room.member"]},"ephemeral":{"types":[]},"account_data":{"types":["m.fully_read","m.marked_unread"]}}});
        let mut request = Request::new(Method::Get, format!("{API}/sync"));
        request
            .query
            .insert("timeout".to_owned(), timeout.to_string());
        request.query.insert(
            "filter".to_owned(),
            serde_json::to_string(&filter).map_err(|_| invalid("Invalid native sync filter"))?,
        );
        if let Some(since) = since {
            request.query.insert("since".to_owned(), since.to_owned());
        }
        request.maximum_bytes = if limit <= 1 {
            HISTORY_BYTES
        } else {
            1024 * 1024
        };
        match protocol::request(matrix, &request, stop.clone()).await {
            Ok(value) => {
                check::text(
                    value
                        .get("next_batch")
                        .ok_or_else(|| invalid("Native sync has no continuation"))?,
                    1,
                    16384,
                )?;
                return Ok(value);
            }
            Err(error) if error.code == ErrorCode::BodyTooLarge && limit > 0 => {
                limit /= 2;
            }
            Err(error) if error.code == ErrorCode::BodyTooLarge => {
                return Err(Failure::new(
                    ErrorCode::Limit,
                    "Native sync state exceeds 64 MiB; unread positions are unchanged",
                ));
            }
            Err(error) => return Err(error),
        }
    }
}
