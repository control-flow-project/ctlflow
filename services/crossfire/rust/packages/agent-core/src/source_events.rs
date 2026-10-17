use crate::{
    events::{self, Event, invalid},
    local_state::LocalState,
    matrix::Matrix,
    receive_pages, receive_snapshots, receive_state,
};
use crossfire_contracts::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
};
use tokio_util::sync::CancellationToken;

pub struct Timeline {
    pub limited: bool,
    pub events: Vec<Value>,
    pub state: Vec<Value>,
}
pub struct Sync {
    pub next: String,
    pub joined: BTreeMap<String, Timeline>,
    pub invited: BTreeSet<String>,
    pub left: BTreeSet<String>,
}
fn array(object: &mut Value, name: &str) -> Result<Vec<Value>> {
    match object
        .as_object_mut()
        .and_then(|object| object.remove(name))
    {
        Some(Value::Array(events)) => Ok(events),
        None => Ok(Vec::new()),
        _ => Err(invalid("Invalid native sync event list")),
    }
}
fn rooms(value: Option<Value>) -> Result<serde_json::Map<String, Value>> {
    match value {
        Some(Value::Object(rooms)) => {
            if rooms.len() > 1000 {
                return Err(Failure::new(
                    ErrorCode::Limit,
                    "Native room metadata exceeds its bounded capacity",
                ));
            }
            for room in rooms.keys() {
                check::room_id(&json!(room))?;
            }
            Ok(rooms)
        }
        None => Ok(serde_json::Map::new()),
        _ => Err(invalid("Invalid native sync rooms")),
    }
}
pub fn parse(mut value: Value) -> Result<Sync> {
    let next = check::text(
        value
            .get("next_batch")
            .ok_or_else(|| invalid("Native sync has no continuation"))?,
        1,
        16384,
    )?
    .to_owned();
    let mut native = value
        .as_object_mut()
        .and_then(|value| value.remove("rooms"))
        .unwrap_or_else(|| json!({}));
    let mut joined = BTreeMap::new();
    let fields = native
        .as_object_mut()
        .ok_or_else(|| invalid("Invalid native sync room sections"))?;
    let invited = rooms(fields.remove("invite"))?
        .into_iter()
        .map(|(room, _)| room)
        .collect();
    let left = rooms(fields.remove("leave"))?
        .into_iter()
        .map(|(room, _)| room)
        .collect();
    for (room, mut data) in rooms(fields.remove("join"))? {
        let data = data
            .as_object_mut()
            .ok_or_else(|| invalid("Invalid native joined-room section"))?;
        let mut timeline = data.remove("timeline").unwrap_or_else(|| json!({}));
        if !timeline.is_object() {
            return Err(invalid("Invalid native sync timeline"));
        }
        let limited = timeline
            .get("limited")
            .map(check::boolean)
            .transpose()?
            .unwrap_or(false);
        let mut state = data.remove("state").unwrap_or_else(|| json!({}));
        joined.insert(
            room,
            Timeline {
                limited,
                events: array(&mut timeline, "events")?,
                state: array(&mut state, "events")?,
            },
        );
    }
    Ok(Sync {
        next,
        joined,
        invited,
        left,
    })
}
pub async fn incremental<F, V>(
    matrix: &impl Matrix,
    sync: Sync,
    since: Option<&str>,
    kind: &str,
    stop: CancellationToken,
    mut visit: V,
) -> Result<()>
where
    F: Future<Output = Result<()>> + Send,
    V: FnMut(Event) -> F,
{
    let Some(since) = since else {
        return Ok(());
    };
    for (room, timeline) in sync.joined {
        let mut seen = BTreeSet::new();
        if timeline.limited {
            let mut from = since.to_owned();
            let mut positions = BTreeSet::new();
            loop {
                let page = receive_pages::history(
                    matrix,
                    &room,
                    &BTreeMap::from([
                        ("from".to_owned(), from.clone()),
                        ("to".to_owned(), sync.next.clone()),
                        ("dir".to_owned(), "f".to_owned()),
                        ("filter".to_owned(), json!({"types":[kind]}).to_string()),
                    ]),
                    100,
                    stop.clone(),
                )
                .await?;
                let count = page.chunk.len();
                for value in page.chunk {
                    let event = events::take(value, &room)?;
                    if seen.insert(event.event_id.clone()) {
                        visit(event).await?;
                    }
                }
                if count == 0 || page.end.as_deref() == Some(&sync.next) {
                    break;
                }
                let next = page
                    .end
                    .ok_or_else(|| invalid("Limited sync history has no continuation"))?;
                if !positions.insert(next.clone()) {
                    return Err(invalid("Limited sync history repeated a continuation"));
                }
                from = next;
            }
        }
        for value in timeline.events {
            if value.get("type").and_then(Value::as_str) != Some(kind) {
                continue;
            }
            let event = events::take(value, &room)?;
            if seen.insert(event.event_id.clone()) {
                visit(event).await?;
            }
        }
    }
    Ok(())
}
pub async fn membership_resets(
    matrix: &impl Matrix,
    sync: &Sync,
    since: Option<&str>,
    principal: &str,
    stop: CancellationToken,
) -> Result<BTreeSet<String>> {
    let mut reset = sync.left.clone();
    let Some(since) = since else {
        return Ok(reset);
    };
    let own = |event: &Value| event["type"] == "m.room.member" && event["state_key"] == principal;
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
    for (room, timeline) in &sync.joined {
        if !timeline.state.iter().chain(&timeline.events).any(own) {
            continue;
        }
        if timeline.state.iter().chain(&timeline.events).any(changed) {
            reset.insert(room.clone());
        }
        if !timeline.limited {
            continue;
        }
        let mut from = since.to_owned();
        let mut visited = BTreeSet::new();
        loop {
            let page = receive_pages::history(
                matrix,
                room,
                &BTreeMap::from([
                    ("from".to_owned(), from.clone()),
                    ("to".to_owned(), sync.next.clone()),
                    ("dir".to_owned(), "f".to_owned()),
                    (
                        "filter".to_owned(),
                        json!({"types":["m.room.member"]}).to_string(),
                    ),
                ]),
                100,
                stop.clone(),
            )
            .await?;
            if page.chunk.iter().any(changed) {
                reset.insert(room.clone());
            }
            if page.chunk.is_empty() || page.end.as_deref() == Some(&sync.next) {
                break;
            }
            let next = page
                .end
                .ok_or_else(|| invalid("Membership history did not advance"))?;
            if !visited.insert(next.clone()) {
                return Err(invalid("Membership history repeated a continuation"));
            }
            from = next;
        }
    }
    Ok(reset)
}
pub fn reset_rooms(storage: &impl LocalState, file: &str, reset: &BTreeSet<String>) -> Result<()> {
    let mut cursors = receive_state::load(storage, file)?;
    for room in reset {
        cursors.remove(room);
    }
    receive_snapshots::retire(storage, file, reset)?;
    receive_state::retain_joined(storage, file, &cursors.keys().cloned().collect())?;
    if let Some(mut wake) = receive_snapshots::load_wake(storage, file)? {
        for room in reset {
            wake.ends.remove(room);
        }
        receive_snapshots::save_wake(
            storage,
            file,
            (!wake.ends.is_empty() && !reset.contains(&wake.room)).then_some(&wake),
        )?;
    }
    Ok(())
}
