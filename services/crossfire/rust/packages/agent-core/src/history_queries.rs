use crate::history_resources::HISTORY_BYTES;
use crate::{
    chat::{self, Artifacts},
    coordination::{self, Coordination},
    events::{Event, invalid},
    local_state::{self, LocalState},
    origins,
    profile::Profile,
    receive_pages,
    receive_state::{self, Batch, Cursors},
    receiver_gate::Gate,
    unread,
};
use crossfire_contracts::validation as check;
use crossfire_domain::messaging_client::MessagingClient;
use crossfire_domain::messaging_client::{Direction, MessagePageRequest};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, time::Clock};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Unread,
    History,
}
pub struct Request {
    pub kind: Kind,
    pub room: Option<String>,
    pub limit: usize,
    pub output_bytes: usize,
    pub direction: String,
    pub cursors: Cursors,
}
pub fn parse(value: &Value) -> Result<Request> {
    let source = check::object(
        value,
        &["kind", "limit", "outputBytes", "direction", "cursors"],
        &["room"],
    )?;
    let kind = match check::choice(&source["kind"], &["unread", "history"])? {
        "unread" => Kind::Unread,
        _ => Kind::History,
    };
    let room = source.get("room").map(check::room_id).transpose()?;
    let cursor_entries = check::object(&source["cursors"], &["entries"], &[])?;
    let mut cursors = BTreeMap::new();
    for entry in check::list(&cursor_entries["entries"], 0, 1000)? {
        let entry = check::object(entry, &["room", "cursor"], &[])?;
        let room = check::room_id(&entry["room"])?;
        let cursor = check::text(&entry["cursor"], 1, 4096)?.to_owned();
        if cursors.insert(room, cursor).is_some() {
            return Err(invalid("Duplicate history continuation room"));
        }
    }
    Ok(Request {
        kind,
        room,
        cursors,
        limit: check::integer(&source["limit"], 1, 100)? as usize,
        output_bytes: check::integer(&source["outputBytes"], 1024, 98304)? as usize,
        direction: check::choice(&source["direction"], &["b", "f"])?.to_owned(),
    })
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Stage {
    Prepared,
    Acknowledging,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Pending {
    id: String,
    base: Cursors,
    batch: Batch,
    message_id: String,
    expires_at: i64,
    stage: Stage,
}
pub struct Queries<S, M, C, A, T> {
    pub storage: Arc<S>,
    pub messaging: Arc<M>,
    pub coordination: Arc<C>,
    pub artifacts: Arc<A>,
    pub clock: T,
    pub profile: Profile,
    pub file: String,
    pub gate: Gate,
}
fn conflict() -> Failure {
    Failure::new(
        ErrorCode::Conflict,
        "Delivery positions changed; the unread query was not acknowledged",
    )
}
impl<S: LocalState, M: MessagingClient, C: Coordination, A: Artifacts, T: Clock + Send + Sync>
    Queries<S, M, C, A, T>
{
    fn pending(&self) -> Result<Option<Pending>> {
        let result = local_state::read::<Pending>(
            self.storage.as_ref(),
            &format!("{}.query", self.file),
            HISTORY_BYTES,
        )?;
        if let Some(pending) = &result {
            check::identifier(&json!(pending.id))?;
            receive_state::validate_cursors(&pending.base)?;
            pending.batch.validate()?;
            if pending.message_id != format!("query-{}", pending.id) || pending.expires_at < 0 {
                return Err(invalid("Invalid retained unread-query identity"));
            }
        }
        Ok(result)
    }
    fn save(&self, pending: &Pending) -> Result<()> {
        local_state::write(
            self.storage.as_ref(),
            &format!("{}.query", self.file),
            pending,
            HISTORY_BYTES,
        )
    }
    fn expire(&self) -> Result<()> {
        let Some(pending) = self.pending()? else {
            return Ok(());
        };
        if pending.stage == Stage::Prepared && pending.expires_at <= self.clock.now()? {
            self.artifacts.release(&[pending.message_id])?;
            self.storage.remove(&format!("{}.query", self.file))?;
        }
        Ok(())
    }
    pub fn is_pending(&self) -> Result<bool> {
        Ok(self
            .gate
            .with_query_state(false, || {
                self.expire()?;
                Ok(self.pending()?.is_some())
            })?
            .unwrap_or(true))
    }
    pub fn content_files(&self) -> Result<BTreeSet<String>> {
        Ok(self
            .pending()?
            .into_iter()
            .flat_map(|pending| pending.batch.events)
            .filter_map(|event| event.content_file.map(|file| file.file))
            .collect())
    }
    async fn allowed(
        &self,
        stop: CancellationToken,
    ) -> Result<(crate::delivery_policy::Policy, BTreeSet<String>)> {
        let policy =
            coordination::policy(self.coordination.as_ref(), &self.profile, stop.clone()).await?;
        if !policy.active {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Agent and owner must both be active",
            ));
        }
        let joined = receive_pages::joined(self.messaging.as_ref(), stop).await?;
        let rooms = policy
            .rooms
            .keys()
            .filter(|room| joined.contains(*room))
            .cloned()
            .collect();
        Ok((policy, rooms))
    }
    pub async fn read(&self, input: Request, stop: CancellationToken) -> Result<Value> {
        let lease = self.gate.query(stop, input.kind == Kind::Unread)?;
        self.expire()?;
        let stop = lease.cancellation();
        let (policy, allowed) = self.allowed(stop.clone()).await?;
        if input
            .room
            .as_ref()
            .is_some_and(|room| !allowed.contains(room))
            || input.cursors.keys().any(|room| !allowed.contains(room))
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Requested history is outside current room access",
            ));
        }
        let original = receive_state::load(self.storage.as_ref(), &self.file)?;
        let mut batch = if input.kind == Kind::Unread {
            if self.pending()?.is_some() {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "A previous unread query requires acknowledgment first",
                ));
            }
            if !input.cursors.is_empty() {
                return Err(invalid(
                    "Unread queries use saved positions, not supplied history cursors",
                ));
            }
            unread::read(
                self.storage.as_ref(),
                self.messaging.as_ref(),
                &self.profile.settings,
                self.artifacts.as_ref(),
                unread::Options {
                    file: &self.file,
                    limit: input.limit,
                    maximum: policy.max_message_bytes,
                    selector: input.room.as_deref(),
                    boundary: None,
                    allowed: &allowed,
                    window: None,
                },
                stop.clone(),
            )
            .await?
        } else {
            let rooms: Vec<_> = input.room.as_ref().map_or_else(
                || allowed.iter().cloned().collect(),
                |room| vec![room.clone()],
            );
            let mut batch = Batch::default();
            let mut file_mode = false;
            for (position, room) in rooms.iter().enumerate() {
                let query = MessagePageRequest {
                    direction: if input.direction == "f" {
                        Direction::Forward
                    } else {
                        Direction::Backward
                    },
                    from: input.cursors.get(room).cloned(),
                    to: None,
                    filter: None,
                    limit: receive_pages::room_quota(input.limit, rooms.len(), position),
                };
                let page =
                    receive_pages::history(self.messaging.as_ref(), room, &query, stop.clone())
                        .await?;
                let count = page.events.len();
                for event in page.events {
                    batch.events.push(crate::events::take(event, room)?);
                }
                if file_mode
                    || chat::acquisition_bytes(&batch.events, &self.profile.settings)?
                        > policy.max_message_bytes
                {
                    file_mode = true;
                    batch.events = self.artifacts.stage(std::mem::take(&mut batch.events))?;
                }
                if let Some(end) = page.end {
                    batch.cursors.insert(room.clone(), end);
                }
                if count >= page.requested_limit {
                    batch.more_rooms.push(room.clone());
                }
            }
            batch
        };
        batch.events = origins::enrich(
            self.messaging.as_ref(),
            &self.profile.account.user_id,
            batch.events,
            stop.clone(),
        )
        .await?;
        let identities =
            coordination::senders(self.coordination.as_ref(), &batch.events, stop).await?;
        lease.check()?;
        let mut envelope = chat::envelope(&batch.events, &self.profile.settings, &identities)?;
        envelope["more_rooms"] = json!(batch.more_rooms);
        envelope["continuation"] = json!({"entries":batch.cursors.iter().filter(|(room, _)| allowed.contains(*room)).map(|(room, cursor)| json!({"room":room,"cursor":cursor})).collect::<Vec<_>>()});
        let mut metadata = envelope.clone();
        metadata
            .as_object_mut()
            .ok_or_else(|| invalid("Invalid query envelope"))?
            .remove("events");
        let id = identity::id();
        let message = format!("query-{id}");
        let text = self.artifacts.prepare(
            &batch.events,
            serde_json::to_string_pretty(&envelope)
                .map_err(|_| invalid("Query encoding failed"))?,
            &message,
            (input.output_bytes - 1).min(policy.max_message_bytes),
            &metadata,
        )?;
        if input.kind == Kind::Unread {
            if self.gate.publishing()?
                || receive_state::load(self.storage.as_ref(), &self.file)? != original
            {
                self.artifacts.release(&[message])?;
                return Err(conflict());
            }
            lease.check()?;
            self.save(&Pending {
                id: id.clone(),
                base: original,
                batch,
                message_id: message,
                expires_at: self.clock.now()?.saturating_add(300000),
                stage: Stage::Prepared,
            })?;
        } else {
            self.artifacts.release(&[message])?;
        }
        Ok(json!({"queryId":(input.kind == Kind::Unread).then_some(id),"text":text}))
    }
    pub async fn acknowledge(&self, id: &str, stop: CancellationToken) -> Result<Vec<Event>> {
        let lease = self.gate.acknowledgment(stop)?;
        self.expire()?;
        let mut pending = self
            .pending()?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Unread query not found"))?;
        if pending.id != id {
            return Err(conflict());
        }
        let (_, allowed) = self.allowed(lease.cancellation()).await?;
        if pending
            .batch
            .events
            .iter()
            .any(|event| !allowed.contains(&event.room_id))
        {
            self.artifacts.release(&[pending.message_id])?;
            self.storage.remove(&format!("{}.query", self.file))?;
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Room authority changed before acknowledgment",
            ));
        }
        let current = receive_state::load(self.storage.as_ref(), &self.file)?;
        if current != pending.base
            && (pending.stage != Stage::Acknowledging || current != pending.batch.cursors)
        {
            return Err(conflict());
        }
        lease.check()?;
        pending.stage = Stage::Acknowledging;
        self.save(&pending)?;
        receive_state::acknowledge(
            self.storage.as_ref(),
            self.messaging.as_ref(),
            &self.file,
            &pending.batch,
            lease.cancellation(),
        )
        .await?;
        self.artifacts.release(&[pending.message_id])?;
        self.storage.remove(&format!("{}.query", self.file))?;
        Ok(pending.batch.events)
    }
    pub async fn recover(&self, stop: CancellationToken) -> Result<Vec<Event>> {
        if let Some(pending) = self.pending()?
            && pending.stage == Stage::Acknowledging
        {
            self.acknowledge(&pending.id, stop).await
        } else {
            Ok(Vec::new())
        }
    }
    pub fn discard_prepared(&self) -> Result<bool> {
        Ok(self
            .gate
            .with_query_state(true, || {
                if let Some(pending) = self.pending()? {
                    if pending.stage == Stage::Acknowledging {
                        return Ok(false);
                    }
                    self.artifacts.release(&[pending.message_id])?;
                    self.storage.remove(&format!("{}.query", self.file))?;
                }
                Ok(true)
            })?
            .unwrap_or(false))
    }
}
