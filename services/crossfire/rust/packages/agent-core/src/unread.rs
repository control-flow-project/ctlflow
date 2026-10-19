use crate::history_resources::HISTORY_BYTES;
use crate::{
    chat::{self, Artifacts},
    events::{self, Event, invalid},
    local_state::LocalState,
    profile::Settings,
    receive_pages,
    receive_state::{self, Batch, Cursors},
};
use crossfire_domain::messaging_client::MessagingClient;
use crossfire_domain::messaging_client::{
    Direction, EventType, MessageEvent, MessagePage, MessagePageRequest,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryEnd {
    pub cursor: String,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub event: Option<MessageEvent>,
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
fn collect(values: Vec<MessageEvent>, room: &str, messages: &mut Vec<Event>) -> Result<()> {
    for value in values {
        if value.event_type != EventType::Other && !events::notice(&value) {
            messages.push(events::take(value, room)?);
        }
    }
    Ok(())
}
pub async fn read(
    storage: &impl LocalState,
    messaging: &impl MessagingClient,
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
    let joined = receive_pages::joined(messaging, stop.clone()).await?;
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
                Some(end) => MessagePage {
                    events: end.event.clone().into_iter().collect(),
                    start: None,
                    end: Some(end.cursor.clone()),
                    requested_limit: 1,
                },
                None => {
                    receive_pages::history(
                        messaging,
                        room,
                        &MessagePageRequest {
                            direction: Direction::Backward,
                            limit: 1,
                            from: None,
                            to: None,
                            filter: None,
                        },
                        stop.clone(),
                    )
                    .await?
                }
            };
            if head.end.is_none() && boundary.is_none() {
                let sync = receive_pages::sync(messaging, None, 0, stop.clone()).await?;
                boundary = Some(sync.cursor);
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
        let mut finished = head.as_ref().is_some_and(|head| head.events.is_empty());
        let mut messages = Vec::new();
        if let Some(head) = head {
            collect(head.events, room, &mut messages)?;
            if chat::acquisition_bytes(&messages, settings)? > options.maximum {
                messages = artifacts.stage(messages)?;
            }
        }
        let mut visited = BTreeSet::new();
        for _page in 0..100 {
            if finished || messages.len() >= quota {
                break;
            }
            let query = MessagePageRequest {
                direction: if fresh {
                    Direction::Backward
                } else {
                    Direction::Forward
                },
                from: Some(from.clone()),
                to: if fresh {
                    None
                } else {
                    end.map(|value| value.cursor.clone())
                },
                filter: None,
                limit: quota.saturating_sub(messages.len()).clamp(1, 100),
            };
            let mut page = receive_pages::history(messaging, room, &query, stop.clone()).await?;
            if !fresh
                && let Some(terminal) = end.and_then(|end| end.event.as_ref())
                && page.events.len() < page.requested_limit
                && !page
                    .events
                    .iter()
                    .any(|value| value.event_id == terminal.event_id)
                && !messages
                    .iter()
                    .any(|value| value.event_id == terminal.event_id)
            {
                page.events.push(terminal.clone());
            }
            finished = page.events.is_empty()
                || page.events.len() < page.requested_limit
                || end.is_some_and(|end| {
                    end.event.as_ref().is_none_or(|event| {
                        page.events
                            .iter()
                            .any(|value| value.event_id == event.event_id)
                    }) || page.end.as_ref() == Some(&end.cursor)
                });
            collect(page.events, room, &mut messages)?;
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
