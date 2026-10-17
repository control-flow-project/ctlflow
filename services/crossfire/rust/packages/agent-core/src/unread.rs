use crate::{
    chat::{self, Artifacts},
    events::{self, Event, invalid},
    local_state::LocalState,
    matrix::{HISTORY_BYTES, Matrix},
    profile::Settings,
    receive_pages::{self, IMPORTANT, Page},
    receive_state::{self, Batch, Cursors},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryEnd {
    pub cursor: String,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub event: Option<Value>,
}
pub struct Window<'a> {
    pub cursors: &'a Cursors,
    pub ends: &'a BTreeMap<String, HistoryEnd>,
}
pub struct Options<'a> {
    pub file: &'a str,
    pub limit: usize,
    pub maximum: usize,
    pub selector: Option<&'a str>,
    pub boundary: Option<&'a str>,
    pub allowed: &'a BTreeSet<String>,
    pub window: Option<Window<'a>>,
}
fn collect(values: Vec<Value>, room: &str, messages: &mut Vec<Event>) -> Result<()> {
    for value in values {
        if !value
            .get("type")
            .and_then(Value::as_str)
            .is_some_and(|kind| IMPORTANT.contains(&kind))
            || events::notice(&value)
        {
            continue;
        }
        messages.push(events::take(value, room)?);
    }
    Ok(())
}
pub async fn read(
    storage: &impl LocalState,
    matrix: &impl Matrix,
    settings: &Settings,
    artifacts: &impl Artifacts,
    options: Options<'_>,
    stop: CancellationToken,
) -> Result<Batch> {
    if !(1..=100).contains(&options.limit)
        || !(1024..=crossfire_domain::runtime::values::MAX_INPUT_BYTES as usize)
            .contains(&options.maximum)
    {
        return Err(invalid("Invalid receive budget"));
    }
    let joined = receive_pages::joined(matrix, stop.clone()).await?;
    let selected: Vec<_> = options
        .selector
        .map_or_else(|| joined.clone(), |room| BTreeSet::from([room.to_owned()]))
        .into_iter()
        .filter(|room| options.allowed.contains(room))
        .collect();
    if selected.iter().any(|room| !joined.contains(room)) {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "The selected agent is not joined to this room",
        ));
    }
    let mut batch = Batch {
        cursors: options.window.as_ref().map_or_else(
            || receive_state::load(storage, options.file),
            |window| Ok(window.cursors.clone()),
        )?,
        ..Batch::default()
    };
    batch.cursors.retain(|room, _| joined.contains(room));
    let mut boundary = options.boundary.map(str::to_owned);
    let mut file_mode = false;
    for (position, room) in selected.iter().enumerate() {
        if stop.is_cancelled() {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "Unread acquisition cancelled without advancing positions",
            ));
        }
        let end = options
            .window
            .as_ref()
            .and_then(|window| window.ends.get(room));
        if options.window.is_some()
            && (end.is_none()
                || batch
                    .cursors
                    .get(room)
                    .is_some_and(|cursor| end.is_some_and(|end| cursor == &end.cursor)))
        {
            continue;
        }
        let quota = receive_pages::room_quota(options.limit, selected.len(), position);
        let fresh = !batch.cursors.contains_key(room);
        let head = if fresh {
            let head = match end {
                Some(end) => Page {
                    chunk: end.event.clone().into_iter().collect(),
                    start: None,
                    end: Some(end.cursor.clone()),
                    requested_limit: 1,
                },
                None => {
                    receive_pages::history(
                        matrix,
                        room,
                        &BTreeMap::from([("dir".to_owned(), "b".to_owned())]),
                        1,
                        stop.clone(),
                    )
                    .await?
                }
            };
            if head.end.is_none() && boundary.is_none() {
                let sync = receive_pages::sync(matrix, None, 0, stop.clone()).await?;
                boundary = sync
                    .get("next_batch")
                    .and_then(Value::as_str)
                    .map(str::to_owned);
            }
            Some(head)
        } else {
            None
        };
        let start = if let Some(head) = &head {
            head.end
                .as_ref()
                .or(boundary.as_ref())
                .cloned()
                .ok_or_else(|| invalid("Missing fresh-room boundary"))?
        } else {
            batch
                .cursors
                .get(room)
                .cloned()
                .ok_or_else(|| invalid("Missing retained room position"))?
        };
        let mut from = start.clone();
        let mut finished = head.as_ref().is_some_and(|head| head.chunk.is_empty());
        let mut messages = Vec::new();
        if let Some(head) = head {
            collect(head.chunk, room, &mut messages)?;
            if chat::acquisition_bytes(&messages, settings)? > options.maximum {
                messages = artifacts.stage(messages)?;
            }
        }
        let mut visited = BTreeSet::new();
        for _page in 0..100 {
            if finished || messages.len() >= quota {
                break;
            }
            let mut query = BTreeMap::from([
                ("dir".to_owned(), if fresh { "b" } else { "f" }.to_owned()),
                ("from".to_owned(), from.clone()),
            ]);
            if !fresh && let Some(end) = end {
                query.insert("to".to_owned(), end.cursor.clone());
            }
            let mut page = receive_pages::history(
                matrix,
                room,
                &query,
                quota.saturating_sub(messages.len()).clamp(1, 100),
                stop.clone(),
            )
            .await?;
            if !fresh
                && let Some(terminal) = end.and_then(|end| end.event.as_ref())
                && page.chunk.len() < page.requested_limit
                && !page
                    .chunk
                    .iter()
                    .any(|value| value.get("event_id") == terminal.get("event_id"))
                && !messages.iter().any(|value| {
                    Some(value.event_id.as_str())
                        == terminal.get("event_id").and_then(Value::as_str)
                })
            {
                page.chunk.push(terminal.clone());
            }
            finished = page.chunk.is_empty()
                || page.chunk.len() < page.requested_limit
                || end.is_some_and(|end| {
                    end.event.as_ref().is_none_or(|event| {
                        page.chunk
                            .iter()
                            .any(|value| value.get("event_id") == event.get("event_id"))
                    }) || page.end.as_ref() == Some(&end.cursor)
                });
            collect(page.chunk, room, &mut messages)?;
            if chat::acquisition_bytes(&messages, settings)? > options.maximum {
                messages = artifacts.stage(messages)?;
            }
            if let Some(next) = page.end {
                if !visited.insert(next.clone()) {
                    return Err(invalid("Native history repeated a continuation"));
                }
                from = next;
            }
        }
        if fresh {
            messages.reverse();
        }
        let room_latest = messages.last().map(|value| value.event_id.clone());
        batch.events.extend(messages);
        if file_mode || chat::acquisition_bytes(&batch.events, settings)? > options.maximum {
            file_mode = true;
            batch.events = artifacts.stage(std::mem::take(&mut batch.events))?;
        }
        batch.cursors.insert(
            room.clone(),
            if fresh {
                start
            } else if finished {
                end.map_or(from.clone(), |end| end.cursor.clone())
            } else {
                from
            },
        );
        if !fresh && !finished {
            batch.more_rooms.push(room.clone());
        }
        if let Some(latest) = room_latest {
            batch.latest.insert(room.clone(), latest);
        }
    }
    batch
        .events
        .sort_by(|first, second| first.timestamp.cmp(&second.timestamp));
    if serde_json::to_vec(&batch)
        .map_err(|_| invalid("Invalid acquisition batch"))?
        .len()
        > HISTORY_BYTES
    {
        return Err(Failure::new(
            ErrorCode::Limit,
            "Collected metadata exceeds its bounded checkpoint",
        ));
    }
    Ok(batch)
}
