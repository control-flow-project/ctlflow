use crate::{
    chat::{self, Artifacts},
    events::{Event, invalid},
    local_state::{self, LocalState},
    matrix::{HISTORY_BYTES, Matrix},
    profile::Settings,
    receive_pages,
    receive_state::{self, Batch, Snapshot},
    unread::{self, HistoryEnd, Options, Window},
};
use crossfire_contracts::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wake {
    pub ends: BTreeMap<String, HistoryEnd>,
    pub sender: String,
    pub room: String,
}
impl Wake {
    pub fn validate(&self) -> Result<()> {
        check::matrix_user_id(&json!(self.sender))?;
        check::room_id(&json!(self.room))?;
        if self.ends.len() > 1000 {
            return Err(invalid("Excessive saved wake-up rooms"));
        }
        for (room, end) in &self.ends {
            check::room_id(&json!(room))?;
            check::text(&json!(end.cursor), 1, 16384)?;
            if let Some(event) = &end.event {
                crate::events::view(event, room)?;
            }
        }
        Ok(())
    }
}
pub fn load_wake(storage: &impl LocalState, file: &str) -> Result<Option<Wake>> {
    let wake: Option<Wake> = local_state::read(storage, &format!("{file}.wake"), HISTORY_BYTES)?;
    if let Some(wake) = &wake {
        wake.validate()?;
    }
    Ok(wake)
}
pub fn save_wake(storage: &impl LocalState, file: &str, wake: Option<&Wake>) -> Result<()> {
    if let Some(wake) = wake {
        wake.validate()?;
        local_state::write(storage, &format!("{file}.wake"), wake, HISTORY_BYTES)
    } else {
        storage.remove(&format!("{file}.wake"))
    }
}
pub async fn capture(
    matrix: &impl Matrix,
    trigger: &Event,
    rooms: &BTreeSet<String>,
    boundary: &str,
    stop: CancellationToken,
) -> Result<Wake> {
    let mut ends = BTreeMap::new();
    let mut bytes = 128;
    for room in rooms {
        let mut page = receive_pages::history(
            matrix,
            room,
            &BTreeMap::from([("dir".to_owned(), "b".to_owned())]),
            1,
            stop.clone(),
        )
        .await?;
        let event = page.chunk.pop();
        if let Some(event) = &event {
            crate::events::view(event, room)?;
        }
        let end = HistoryEnd {
            cursor: page.end.unwrap_or_else(|| boundary.to_owned()),
            event,
        };
        bytes += local_state::encoded_bytes(&end)? + local_state::encoded_bytes(room)? + 2;
        if bytes > HISTORY_BYTES {
            return Err(Failure::new(
                ErrorCode::Limit,
                "Wake-up evidence exceeds its bounded checkpoint; unread positions are unchanged",
            ));
        }
        ends.insert(room.clone(), end);
    }
    let wake = Wake {
        ends,
        sender: trigger.sender.clone(),
        room: trigger.room_id.clone(),
    };
    wake.validate()?;
    Ok(wake)
}
pub fn snapshot(storage: &impl LocalState, file: &str) -> Result<Option<Snapshot>> {
    let snapshot: Option<Snapshot> =
        local_state::read(storage, &format!("{file}.snapshot"), HISTORY_BYTES)?;
    if let Some(snapshot) = &snapshot {
        receive_state::validate_cursors(&snapshot.base)?;
        snapshot.batch.validate()?;
    }
    Ok(snapshot)
}
pub fn content_files(storage: &impl LocalState, file: &str) -> Result<BTreeSet<String>> {
    Ok(snapshot(storage, file)?
        .into_iter()
        .flat_map(|snapshot| snapshot.batch.events)
        .filter_map(|event| event.content_file.map(|file| file.file))
        .collect())
}
pub fn retire(storage: &impl LocalState, file: &str, rooms: &BTreeSet<String>) -> Result<()> {
    let Some(mut snapshot) = snapshot(storage, file)? else {
        return Ok(());
    };
    snapshot
        .batch
        .events
        .retain(|event| !rooms.contains(&event.room_id));
    for room in rooms {
        snapshot.base.remove(room);
        snapshot.batch.cursors.remove(room);
        snapshot.batch.latest.remove(room);
    }
    snapshot
        .batch
        .more_rooms
        .retain(|room| !rooms.contains(room));
    if snapshot
        .batch
        .cursors
        .keys()
        .any(|room| !snapshot.base.contains_key(room))
    {
        local_state::write(
            storage,
            &format!("{file}.snapshot"),
            &snapshot,
            HISTORY_BYTES,
        )
    } else {
        storage.remove(&format!("{file}.snapshot"))
    }
}
pub async fn pending(
    storage: &impl LocalState,
    matrix: &impl Matrix,
    settings: &Settings,
    artifacts: &impl Artifacts,
    options: Options<'_>,
    stop: CancellationToken,
) -> Result<Batch> {
    let base = receive_state::load(storage, options.file)?;
    if let Some(mut saved) = snapshot(storage, options.file)? {
        if saved.base == base {
            let included = |room: &str| {
                options.allowed.contains(room)
                    && options.selector.is_none_or(|selector| selector == room)
            };
            if options.window.is_none() {
                let added: BTreeSet<_> = receive_pages::joined(matrix, stop.clone())
                    .await?
                    .into_iter()
                    .filter(|room| included(room) && !saved.batch.cursors.contains_key(room))
                    .collect();
                if !added.is_empty() {
                    let initial = unread::read(
                        storage,
                        matrix,
                        settings,
                        artifacts,
                        Options {
                            allowed: &added,
                            ..options
                        },
                        stop.clone(),
                    )
                    .await?;
                    saved.batch.events.extend(initial.events);
                    saved.batch.cursors.extend(
                        initial
                            .cursors
                            .into_iter()
                            .filter(|(room, _)| added.contains(room)),
                    );
                    saved.batch.latest.extend(initial.latest);
                    saved.batch.more_rooms.extend(initial.more_rooms);
                    if chat::acquisition_bytes(&saved.batch.events, settings)? > options.maximum {
                        saved.batch.events = artifacts.stage(saved.batch.events)?;
                    }
                    local_state::write(
                        storage,
                        &format!("{}.snapshot", options.file),
                        &saved,
                        HISTORY_BYTES,
                    )?;
                }
            }
            saved.batch.events.retain(|event| included(&event.room_id));
            saved.batch.cursors.retain(|room, _| included(room));
            let mut cursors = base;
            cursors.extend(saved.batch.cursors);
            saved.batch.cursors = cursors;
            saved.batch.latest.retain(|room, _| included(room));
            saved.batch.more_rooms.retain(|room| included(room));
            return Ok(saved.batch);
        }
        storage.remove(&format!("{}.snapshot", options.file))?;
    }
    let file = options.file;
    let batch = unread::read(storage, matrix, settings, artifacts, options, stop).await?;
    if batch.cursors.keys().any(|room| !base.contains_key(room)) {
        local_state::write(
            storage,
            &format!("{file}.snapshot"),
            &Snapshot {
                base,
                batch: batch.clone(),
            },
            HISTORY_BYTES,
        )?;
    }
    Ok(batch)
}
pub async fn wake(
    matrix: &impl Matrix,
    batch: &Batch,
    senders: &BTreeSet<String>,
    allowed: &BTreeSet<String>,
    selector: Option<&str>,
    accept: impl Fn(&Event) -> bool,
    stop: CancellationToken,
) -> Result<Option<Event>> {
    let eligible = |event: &Event| {
        event.kind == "m.room.message" && senders.contains(&event.sender) && accept(event)
    };
    if let Some(event) = batch.events.iter().find(|event| eligible(event)) {
        return Ok(Some(event.clone()));
    }
    let identities: Vec<_> = senders.iter().collect();
    for room in allowed
        .iter()
        .filter(|room| selector.is_none_or(|selector| selector == *room))
    {
        let Some(start) = batch.cursors.get(room) else {
            continue;
        };
        for selected in identities.chunks(50) {
            let mut from = start.clone();
            let mut visited = BTreeSet::new();
            loop {
                let page = receive_pages::history(
                    matrix,
                    room,
                    &BTreeMap::from([
                        ("from".to_owned(), from.clone()),
                        ("dir".to_owned(), "f".to_owned()),
                        (
                            "filter".to_owned(),
                            json!({"types":["m.room.message"],"senders":selected}).to_string(),
                        ),
                    ]),
                    100,
                    stop.clone(),
                )
                .await?;
                if page.chunk.is_empty() {
                    break;
                }
                for value in page.chunk {
                    let candidate = crate::events::take(value, room)?;
                    if eligible(&candidate) {
                        return Ok(Some(candidate));
                    }
                }
                let next = page
                    .end
                    .ok_or_else(|| invalid("Wake-up history did not advance"))?;
                if !visited.insert(next.clone()) {
                    return Err(invalid("Wake-up history repeated a continuation"));
                }
                from = next;
            }
        }
    }
    Ok(None)
}
pub async fn collect(
    storage: &impl LocalState,
    matrix: &impl Matrix,
    settings: &Settings,
    artifacts: &impl Artifacts,
    mut batch: Batch,
    options: Options<'_>,
    stop: CancellationToken,
) -> Result<Batch> {
    let window = options
        .window
        .ok_or_else(|| invalid("Collecting a wake-up requires captured room boundaries"))?;
    let rooms: Vec<_> = window
        .ends
        .keys()
        .filter(|room| options.allowed.contains(*room))
        .cloned()
        .collect();
    for (position, room) in rooms.iter().enumerate() {
        let quota = receive_pages::room_quota(options.limit, rooms.len(), position);
        let remaining = quota.saturating_sub(
            batch
                .events
                .iter()
                .filter(|event| &event.room_id == room)
                .count(),
        );
        if remaining == 0 || batch.cursors.get(room) == window.ends.get(room).map(|end| &end.cursor)
        {
            continue;
        }
        let allowed = BTreeSet::from([room.clone()]);
        let next = unread::read(
            storage,
            matrix,
            settings,
            artifacts,
            Options {
                file: options.file,
                limit: remaining,
                maximum: options.maximum,
                selector: Some(room),
                boundary: None,
                allowed: &allowed,
                window: Some(Window {
                    cursors: &batch.cursors,
                    ends: window.ends,
                }),
            },
            stop.clone(),
        )
        .await?;
        batch.events.extend(next.events);
        if chat::acquisition_bytes(&batch.events, settings)? > options.maximum {
            batch.events = artifacts.stage(batch.events)?;
        }
        if let Some(cursor) = next.cursors.get(room) {
            batch.cursors.insert(room.clone(), cursor.clone());
        }
        batch.latest.extend(next.latest);
    }
    batch
        .events
        .sort_by(|left, right| left.timestamp.cmp(&right.timestamp));
    batch.more_rooms = rooms
        .into_iter()
        .filter(|room| batch.cursors.get(room) != window.ends.get(room).map(|end| &end.cursor))
        .collect();
    Ok(batch)
}
