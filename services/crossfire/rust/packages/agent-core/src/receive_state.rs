use crate::{
    events::{Event, invalid},
    local_state::{self, LocalState},
    matrix::{self, API, Matrix, Request},
    receive_pages,
};
use crossfire_contracts::{operations::Method, origin::segment, validation as check};
use crossfire_kernel::Result;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use tokio_util::sync::CancellationToken;

pub type Cursors = BTreeMap<String, String>;
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Batch {
    pub events: Vec<Event>,
    pub cursors: Cursors,
    pub more_rooms: Vec<String>,
    pub latest: Cursors,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub base: Cursors,
    pub batch: Batch,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Ack {
    cursors: Cursors,
    receipts: Cursors,
}
pub fn validate_cursors(values: &Cursors) -> Result<()> {
    if values.len() > 1000 {
        return Err(invalid("Excessive retained room positions"));
    }
    for (room, cursor) in values {
        check::room_id(&json!(room))?;
        check::text(&json!(cursor), 1, 16384)?;
    }
    Ok(())
}
impl Batch {
    pub fn validate(&self) -> Result<()> {
        validate_cursors(&self.cursors)?;
        validate_cursors(&self.latest)?;
        if self.events.len() > 100000 || self.more_rooms.len() > 1000 {
            return Err(invalid("Excessive retained events"));
        }
        for room in &self.more_rooms {
            check::room_id(&json!(room))?;
        }
        for event in &self.events {
            event.validate()?;
        }
        Ok(())
    }
}
pub fn load(storage: &impl LocalState, file: &str) -> Result<Cursors> {
    let values: Cursors =
        local_state::read(storage, file, matrix::HISTORY_BYTES)?.unwrap_or_default();
    validate_cursors(&values)?;
    Ok(values)
}
pub fn sync_cursor(storage: &impl LocalState, file: &str) -> Result<Option<String>> {
    let result: Option<String> = local_state::read(storage, &format!("{file}.sync"), 32768)?;
    if let Some(value) = &result {
        check::text(&json!(value), 1, 16384)?;
    }
    Ok(result)
}
pub fn checkpoint_sync(storage: &impl LocalState, file: &str, since: &str) -> Result<()> {
    check::text(&json!(since), 1, 16384)?;
    if sync_cursor(storage, file)?.as_deref() != Some(since) {
        local_state::write(storage, &format!("{file}.sync"), &since, 32768)?;
    }
    Ok(())
}
pub fn filter(values: &Cursors, rooms: &BTreeSet<String>) -> Cursors {
    values
        .iter()
        .filter(|(room, _)| rooms.contains(*room))
        .map(|(room, cursor)| (room.clone(), cursor.clone()))
        .collect()
}
pub fn retain_joined(
    storage: &impl LocalState,
    file: &str,
    joined: &BTreeSet<String>,
) -> Result<()> {
    let current = load(storage, file)?;
    let retained = filter(&current, joined);
    if retained == current {
        return Ok(());
    }
    if let Some(mut pending) =
        local_state::read::<Ack>(storage, &format!("{file}.ack"), matrix::HISTORY_BYTES)?
    {
        validate_cursors(&pending.cursors)?;
        validate_cursors(&pending.receipts)?;
        pending.cursors = retained.clone();
        pending.receipts = filter(&pending.receipts, joined);
        local_state::write(
            storage,
            &format!("{file}.ack"),
            &pending,
            matrix::HISTORY_BYTES,
        )?;
    }
    local_state::write(storage, file, &retained, matrix::HISTORY_BYTES)
}
pub async fn acknowledge(
    storage: &impl LocalState,
    matrix: &impl Matrix,
    file: &str,
    batch: &Batch,
    stop: CancellationToken,
) -> Result<()> {
    batch.validate()?;
    flush(storage, matrix, file, stop.clone()).await?;
    let receipts: Cursors = batch
        .latest
        .iter()
        .filter(|(room, event)| {
            batch
                .events
                .iter()
                .any(|value| &value.room_id == *room && &value.event_id == *event)
        })
        .map(|(room, event)| (room.clone(), event.clone()))
        .collect();
    if load(storage, file)? == batch.cursors && receipts.is_empty() {
        return Ok(());
    }
    local_state::write(
        storage,
        &format!("{file}.ack"),
        &Ack {
            cursors: batch.cursors.clone(),
            receipts,
        },
        matrix::HISTORY_BYTES,
    )?;
    flush(storage, matrix, file, stop).await
}
pub async fn flush(
    storage: &impl LocalState,
    matrix: &impl Matrix,
    file: &str,
    stop: CancellationToken,
) -> Result<()> {
    let pending_file = format!("{file}.ack");
    let Some(pending): Option<Ack> =
        local_state::read(storage, &pending_file, matrix::HISTORY_BYTES)?
    else {
        return Ok(());
    };
    validate_cursors(&pending.cursors)?;
    validate_cursors(&pending.receipts)?;
    let snapshot_file = format!("{file}.snapshot");
    if let Some(mut snapshot) =
        local_state::read::<Snapshot>(storage, &snapshot_file, matrix::HISTORY_BYTES)?
    {
        validate_cursors(&snapshot.base)?;
        snapshot.batch.validate()?;
        let remaining: BTreeSet<_> = snapshot
            .batch
            .cursors
            .keys()
            .filter(|room| {
                !snapshot.base.contains_key(*room)
                    && !pending.cursors.contains_key(*room)
                    && !pending.receipts.contains_key(*room)
            })
            .cloned()
            .collect();
        if remaining.is_empty() {
            storage.remove(&snapshot_file)?;
        } else {
            snapshot
                .batch
                .events
                .retain(|value| remaining.contains(&value.room_id));
            snapshot.batch.cursors = filter(&snapshot.batch.cursors, &remaining);
            snapshot.batch.latest = filter(&snapshot.batch.latest, &remaining);
            snapshot
                .batch
                .more_rooms
                .retain(|room| remaining.contains(room));
            snapshot.base = pending.cursors.clone();
            local_state::write(storage, &snapshot_file, &snapshot, matrix::HISTORY_BYTES)?;
        }
    }
    local_state::write(storage, file, &pending.cursors, matrix::HISTORY_BYTES)?;
    let joined = receive_pages::joined(matrix, stop.clone()).await?;
    for (room, event) in pending.receipts {
        if !joined.contains(&room) {
            continue;
        }
        check::event_id(&json!(event))?;
        let mut request = Request::new(
            Method::Post,
            format!("{API}/rooms/{}/read_markers", segment(&room)),
        );
        request.body = Some(json!({"m.fully_read":event,"m.read.private":event}));
        matrix::request(matrix, &request, stop.clone()).await?;
    }
    storage.remove(&pending_file)
}
