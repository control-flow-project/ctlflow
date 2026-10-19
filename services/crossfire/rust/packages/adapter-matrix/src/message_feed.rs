use crate::{
    agent::Client,
    message_events,
    protocol::{self, API, Request},
};
use crossfire_contracts::{operations::Method, origin::segment, validation as check};
use crossfire_domain::messaging_client::*;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};
use tokio_util::sync::CancellationToken;

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
fn rooms(value: Option<&Value>) -> Result<Map<String, Value>> {
    match value {
        None => Ok(Map::new()),
        Some(Value::Object(rooms)) if rooms.len() <= 1000 => {
            for room in rooms.keys() {
                crate::syntax::room_id(&json!(room))?;
            }
            Ok(rooms.clone())
        }
        _ => Err(invalid("Invalid or excessive Matrix room metadata")),
    }
}
fn array(value: Option<&Value>) -> Result<Vec<Value>> {
    match value {
        None => Ok(Vec::new()),
        Some(Value::Array(events)) => Ok(events.clone()),
        _ => Err(invalid("Invalid Matrix event collection")),
    }
}
pub async fn parse(
    client: &Client<impl protocol::Protocol>,
    value: Value,
    since: Option<&str>,
    stop: CancellationToken,
) -> Result<MessageFeed> {
    let cursor = check::text(value.get("next_batch").unwrap_or(&Value::Null), 1, 16384)?.to_owned();
    let sections = value
        .get("rooms")
        .map(|value| {
            value
                .as_object()
                .ok_or_else(|| invalid("Invalid Matrix room sections"))
        })
        .transpose()?
        .cloned()
        .unwrap_or_default();
    let invitations = rooms(sections.get("invite"))?
        .into_iter()
        .map(|(room, _)| room)
        .collect();
    let departed_rooms: Vec<_> = rooms(sections.get("leave"))?
        .into_iter()
        .map(|(room, _)| room)
        .collect();
    let mut reset: BTreeSet<_> = departed_rooms.iter().cloned().collect();
    let mut joined = BTreeMap::new();
    for (room, data) in rooms(sections.get("join"))? {
        let data = data
            .as_object()
            .ok_or_else(|| invalid("Invalid Matrix joined-room section"))?;
        let timeline = data
            .get("timeline")
            .map(|value| {
                value
                    .as_object()
                    .ok_or_else(|| invalid("Invalid Matrix timeline"))
            })
            .transpose()?
            .cloned()
            .unwrap_or_default();
        let state = data
            .get("state")
            .map(|value| {
                value
                    .as_object()
                    .ok_or_else(|| invalid("Invalid Matrix state collection"))
            })
            .transpose()?
            .cloned()
            .unwrap_or_default();
        let events = array(timeline.get("events"))?;
        let states = array(state.get("events"))?;
        let limited = timeline
            .get("limited")
            .map(check::boolean)
            .transpose()?
            .unwrap_or(false);
        let own = |event: &Value| {
            event.get("type").and_then(Value::as_str) == Some("m.room.member")
                && event.get("state_key").and_then(Value::as_str) == Some(client.user.as_str())
        };
        let changed = |event: &Value| {
            own(event)
                && (matches!(
                    event["content"]["membership"].as_str(),
                    Some("leave" | "ban")
                ) || event["content"]["membership"] == "join"
                    && matches!(
                        event["unsigned"]["prev_content"]["membership"].as_str(),
                        Some("leave" | "ban" | "invite" | "knock")
                    ))
        };
        if since.is_some() && events.iter().chain(&states).any(changed) {
            reset.insert(room.clone());
        }
        if limited
            && let Some(since) = since
            && events.iter().chain(&states).any(own)
        {
            let mut from = since.to_owned();
            let mut visited = BTreeSet::new();
            loop {
                let page = client
                    .raw_history(
                        &room,
                        &MessagePageRequest {
                            direction: Direction::Forward,
                            from: Some(from.clone()),
                            to: Some(cursor.clone()),
                            limit: 100,
                            filter: Some(EventFilter {
                                types: Some(vec![EventType::Membership]),
                                senders: None,
                            }),
                        },
                        stop.clone(),
                    )
                    .await?;
                if page.chunk.iter().any(changed) {
                    reset.insert(room.clone());
                }
                if page.chunk.is_empty() || page.end.as_deref() == Some(&cursor) {
                    break;
                }
                from = page
                    .end
                    .ok_or_else(|| invalid("Matrix membership history has no continuation"))?;
                if !visited.insert(from.clone()) {
                    return Err(invalid("Matrix membership history repeated a continuation"));
                }
            }
        }
        let read_state = array(
            data.get("account_data")
                .and_then(|value| value.get("events")),
        )?
        .into_iter()
        .filter(|event| {
            matches!(
                event.get("type").and_then(Value::as_str),
                Some("m.fully_read" | "m.marked_unread")
            )
        })
        .collect();
        let notifications = data
            .get("unread_notifications")
            .map(|value| {
                value
                    .as_object()
                    .cloned()
                    .map(Value::Object)
                    .ok_or_else(|| invalid("Invalid Matrix notification metadata"))
            })
            .transpose()?;
        joined.insert(
            room.clone(),
            RoomFeed {
                events: events
                    .iter()
                    .map(|value| message_events::parse(value, &room))
                    .collect::<Result<_>>()?,
                limited,
                previous_cursor: timeline
                    .get("prev_batch")
                    .filter(|value| !value.is_null())
                    .map(|value| check::text(value, 1, 16384).map(str::to_owned))
                    .transpose()?,
                notifications,
                read_state,
            },
        );
    }
    Ok(MessageFeed {
        cursor,
        rooms: joined,
        invitations,
        departed_rooms,
        reset_rooms: reset.into_iter().collect(),
    })
}
pub async fn origins(
    client: &Client<impl protocol::Protocol>,
    user: &str,
    selected: &[String],
    stop: CancellationToken,
) -> Result<BTreeMap<String, RoomOrigin>> {
    crate::syntax::user_id(&json!(user))?;
    let response = protocol::request(
        client,
        &Request::new(
            Method::Get,
            format!("{API}/user/{}/account_data/m.direct", segment(user)),
        ),
        stop.clone(),
    )
    .await;
    let mut private = BTreeSet::new();
    match response {
        Ok(Value::Object(direct)) => {
            for (user, values) in direct {
                crate::syntax::user_id(&json!(user))?;
                for value in check::list(&values, 0, 1000)? {
                    private.insert(crate::syntax::room_id(value)?);
                }
            }
        }
        Err(error) if error.code == ErrorCode::Missing => {}
        Err(error) => return Err(error),
        _ => return Err(invalid("Invalid Matrix direct-message map")),
    }
    let mut result = BTreeMap::new();
    for room in selected {
        let state = client.state_values(room, stop.clone()).await?;
        let fields = |kind: &str, key: &str| {
            state
                .iter()
                .find(|event| {
                    event.get("type").and_then(Value::as_str) == Some(kind)
                        && event.get("state_key").and_then(Value::as_str) == Some("")
                })
                .and_then(|event| event.get("content"))
                .and_then(|content| content.get(key))
                .and_then(Value::as_str)
                .map(str::to_owned)
        };
        result.insert(
            room.clone(),
            RoomOrigin {
                kind: if private.contains(room) {
                    OriginKind::Dm
                } else {
                    OriginKind::Room
                },
                name: fields("m.room.name", "name"),
                alias: fields("m.room.canonical_alias", "alias"),
            },
        );
    }
    Ok(result)
}
