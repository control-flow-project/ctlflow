use crate::matrix::{self, API, HISTORY_BYTES, Matrix, Request};
use crossfire_contracts::{operations::Method, origin::segment, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use tokio_util::sync::CancellationToken;

pub const IMPORTANT: &[&str] = &[
    "m.room.message",
    "m.room.encrypted",
    "m.room.redaction",
    "m.room.name",
    "m.room.topic",
    "m.room.member",
    "m.room.power_levels",
    "m.room.join_rules",
    "m.room.history_visibility",
    "m.room.encryption",
    "m.room.tombstone",
];
pub struct Page {
    pub chunk: Vec<Value>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub requested_limit: usize,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub fn room_quota(limit: usize, rooms: usize, position: usize) -> usize {
    let split = limit / rooms.max(1) + usize::from(position < limit % rooms.max(1));
    split.max(if limit == 100 { 10 } else { 1 })
}
pub async fn joined(matrix: &impl Matrix, stop: CancellationToken) -> Result<BTreeSet<String>> {
    let response = matrix::request(
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
        .map(check::room_id)
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
    matrix: &impl Matrix,
    room: &str,
    query: &BTreeMap<String, String>,
    requested: usize,
    stop: CancellationToken,
) -> Result<Page> {
    check::room_id(&json!(room))?;
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
        let response = matrix::request(matrix, &input, stop.clone()).await;
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
    matrix: &impl Matrix,
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
        match matrix::request(matrix, &request, stop.clone()).await {
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
pub async fn invitations(
    matrix: &impl Matrix,
    stop: CancellationToken,
) -> Result<BTreeSet<String>> {
    let mut request = Request::new(Method::Get, format!("{API}/sync"));
    request.query.insert("timeout".to_owned(), "0".to_owned());
    request.query.insert("filter".to_owned(), json!({"presence":{"types":[]},"account_data":{"types":[]},"room":{"timeline":{"limit":0},"state":{"types":[]},"ephemeral":{"types":[]},"account_data":{"types":[]}}}).to_string());
    request.maximum_bytes = HISTORY_BYTES;
    let response = matrix::request(matrix, &request, stop).await?;
    match response.get("rooms").and_then(|rooms| rooms.get("invite")) {
        None => Ok(BTreeSet::new()),
        Some(Value::Object(rooms)) if rooms.len() <= 1000 => rooms
            .keys()
            .map(|room| check::room_id(&json!(room)).map(|_| room.clone()))
            .collect(),
        _ => Err(invalid("Invalid native room invitation list")),
    }
}
