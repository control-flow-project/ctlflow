use crate::{
    chat::{self, Artifacts},
    coordination,
    events::{Event, invalid},
    local_state::{self, LocalState},
    profile::Settings,
    receive_state::{self, Batch},
    runtime::{Admission, Connection, InputPriority},
};
use crossfire_contracts::{validation as check, views};
use crossfire_domain::{read::values::PrincipalIdentity, runtime::values::HistoryMode};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const JOURNAL_BYTES: usize = 128 * 1024 * 1024;
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Status {
    Prepared,
    Publishing,
    Delivered,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Step {
    indices: Vec<usize>,
    text: String,
    id: String,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    room: Option<String>,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    session: Option<String>,
    status: Status,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Plan {
    mode: String,
    batch: Batch,
    identities: Vec<Value>,
    steps: Vec<Step>,
}
pub struct Outcome {
    pub batch: Batch,
    pub message_ids: Vec<String>,
    pub deliveries: Vec<(String, String)>,
}
pub struct Publication<S, N, A> {
    storage: Arc<S>,
    native: Arc<N>,
    artifacts: Arc<A>,
    settings: Settings,
    file: String,
    mode: HistoryMode,
    priority: Option<InputPriority>,
    plan: Mutex<Option<Plan>>,
}
fn conflict(message: &str) -> Failure {
    Failure::new(ErrorCode::Conflict, message)
}
fn mode_name(mode: HistoryMode) -> &'static str {
    match mode {
        HistoryMode::Shared => "shared",
        HistoryMode::PerRoom => "per-room",
    }
}
fn validate(plan: &Plan, mode: HistoryMode) -> Result<()> {
    plan.batch.validate()?;
    if plan.mode != mode_name(mode) || plan.identities.len() > 100000 || plan.steps.len() > 100000 {
        return Err(invalid(
            "Pending publication has a changed history mode or excessive records",
        ));
    }
    let mut senders = BTreeSet::new();
    for value in &plan.identities {
        if !senders.insert(coordination::identity(value)?.backend_user_id) {
            return Err(invalid("Duplicate retained sender identity"));
        }
    }
    let mut indices = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for step in &plan.steps {
        check::text(&json!(step.id), 1, 200)?;
        if step.text.len() > crossfire_domain::runtime::values::MAX_INPUT_BYTES as usize
            || step.indices.is_empty()
            || step
                .indices
                .iter()
                .any(|index| *index >= plan.batch.events.len() || !indices.insert(*index))
            || !ids.insert(&step.id)
        {
            return Err(invalid("Invalid original native publication evidence"));
        }
        if (mode == HistoryMode::PerRoom) != step.room.is_some()
            || step.status != Status::Prepared && step.session.is_none()
        {
            return Err(invalid("Publication requires the exact original history"));
        }
        if let Some(room) = &step.room {
            check::room_id(&json!(room))?;
            if step
                .indices
                .iter()
                .any(|index| &plan.batch.events[*index].room_id != room)
            {
                return Err(invalid("Per-room publication contains another room"));
            }
        }
        if let Some(session) = &step.session {
            check::text(&json!(session), 1, 255)?;
        }
    }
    Ok(())
}
impl<S: LocalState, N: Connection, A: Artifacts> Publication<S, N, A> {
    pub fn open(
        storage: Arc<S>,
        native: Arc<N>,
        artifacts: Arc<A>,
        settings: Settings,
        file: &str,
        mode: HistoryMode,
        priority: Option<InputPriority>,
    ) -> Result<Self> {
        let plan = local_state::read::<Plan>(storage.as_ref(), file, JOURNAL_BYTES)?;
        if let Some(plan) = &plan {
            validate(plan, mode)?;
        }
        Ok(Self {
            storage,
            native,
            artifacts,
            settings,
            file: file.to_owned(),
            mode,
            priority,
            plan: Mutex::new(plan),
        })
    }
    fn save(&self, plan: &Plan) -> Result<()> {
        validate(plan, self.mode)?;
        local_state::write(self.storage.as_ref(), &self.file, plan, JOURNAL_BYTES)
    }
    pub fn pending(&self) -> Result<bool> {
        Ok(self
            .plan
            .try_lock()
            .map_err(|_| conflict("A native publication operation is already running"))?
            .is_some())
    }
    pub fn recovering(&self) -> Result<bool> {
        Ok(self
            .plan
            .try_lock()
            .map_err(|_| conflict("A native publication operation is already running"))?
            .as_ref()
            .is_some_and(|plan| {
                plan.steps
                    .iter()
                    .any(|step| step.status == Status::Publishing)
            }))
    }
    pub fn content_files(&self) -> Result<BTreeSet<String>> {
        Ok(self
            .plan
            .try_lock()
            .map_err(|_| conflict("A native publication operation is already running"))?
            .as_ref()
            .into_iter()
            .flat_map(|plan| &plan.batch.events)
            .filter_map(|event| event.content_file.as_ref().map(|file| file.file.clone()))
            .collect())
    }
    fn steps(
        &self,
        events: Vec<Event>,
        identities: &BTreeMap<String, PrincipalIdentity>,
        records: &[Event],
        maximum: usize,
    ) -> Result<Vec<Step>> {
        let positions: BTreeMap<_, _> = records
            .iter()
            .enumerate()
            .map(|(position, event)| ((&event.room_id, &event.event_id), position))
            .collect();
        if positions.len() != records.len() {
            return Err(invalid("Duplicate event in the publication checkpoint"));
        }
        chat::prepare(
            events,
            &self.settings,
            identities,
            maximum,
            self.mode,
            self.artifacts.as_ref(),
        )?
        .into_iter()
        .map(|batch| {
            let indices = batch
                .events
                .iter()
                .map(|event| {
                    positions
                        .get(&(&event.room_id, &event.event_id))
                        .copied()
                        .ok_or_else(|| {
                            invalid("Publication event is outside its original checkpoint")
                        })
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(Step {
                indices,
                text: batch.text,
                id: batch.message_id,
                room: batch.room,
                session: None,
                status: Status::Prepared,
            })
        })
        .collect()
    }
    pub fn prepare(
        &self,
        mut batch: Batch,
        selected: Vec<Event>,
        identities: &BTreeMap<String, PrincipalIdentity>,
        maximum: usize,
    ) -> Result<()> {
        let mut current = self
            .plan
            .try_lock()
            .map_err(|_| conflict("A native publication operation is already running"))?;
        if current.is_some() {
            return Err(conflict(
                "Settle original input before preparing another publication",
            ));
        }
        let enriched: BTreeMap<_, _> = selected
            .iter()
            .map(|event| ((&event.room_id, &event.event_id), event))
            .collect();
        for event in &mut batch.events {
            if let Some(value) = enriched.get(&(&event.room_id, &event.event_id)) {
                *event = (*value).clone();
            }
        }
        let steps = self.steps(selected, identities, &batch.events, maximum)?;
        let plan = Plan {
            mode: mode_name(self.mode).to_owned(),
            batch,
            identities: identities.values().map(views::identity).collect(),
            steps,
        };
        self.save(&plan)?;
        *current = Some(plan);
        Ok(())
    }
    async fn target(&self, step: &Step, stop: CancellationToken) -> Result<Option<N>> {
        match &step.room {
            Some(room) => self
                .native
                .conversation(
                    room,
                    self.priority
                        .map(|priority| Admission {
                            priority,
                            cancellation: stop,
                        })
                        .as_ref(),
                )
                .await
                .map(Some),
            None => Ok(None),
        }
    }
    fn outcome(plan: &Plan, allowed: &BTreeSet<String>) -> Option<Outcome> {
        if plan
            .steps
            .iter()
            .any(|step| step.status != Status::Delivered)
        {
            return None;
        }
        let mut batch = plan.batch.clone();
        batch.cursors = receive_state::filter(&batch.cursors, allowed);
        batch.latest = receive_state::filter(&batch.latest, allowed);
        batch.more_rooms.retain(|room| allowed.contains(room));
        let deliveries = plan
            .steps
            .iter()
            .filter_map(|step| {
                step.indices
                    .iter()
                    .rev()
                    .filter_map(|index| plan.batch.events.get(*index))
                    .find(|event| {
                        event.kind == crossfire_domain::messaging_client::EventType::Message
                    })
                    .and_then(|event| {
                        step.session
                            .as_ref()
                            .map(|session| (event.room_id.clone(), session.clone()))
                    })
            })
            .collect();
        Some(Outcome {
            batch,
            message_ids: plan.steps.iter().map(|step| step.id.clone()).collect(),
            deliveries,
        })
    }
    pub async fn recover(
        &self,
        allowed: &BTreeSet<String>,
        stop: CancellationToken,
    ) -> Result<Option<Outcome>> {
        let mut current = self
            .plan
            .try_lock()
            .map_err(|_| conflict("A native publication operation is already running"))?;
        let Some(plan) = current.as_mut() else {
            return Ok(None);
        };
        for position in 0..plan.steps.len() {
            let step = &plan.steps[position];
            if step.status != Status::Publishing {
                continue;
            }
            let selected = self.target(step, stop.clone()).await?;
            let target = selected.as_ref().unwrap_or(self.native.as_ref());
            if step.session.as_deref() != Some(target.session_id()) {
                return Err(conflict(
                    "Original pending history is unavailable; input was not retargeted",
                ));
            }
            let received = target.recover(&step.text, &step.id, stop.clone()).await?;
            plan.steps[position].status = if received {
                Status::Delivered
            } else {
                Status::Prepared
            };
            self.save(plan)?;
        }
        Ok(Self::outcome(plan, allowed))
    }
    pub async fn publish(
        &self,
        allowed: &BTreeSet<String>,
        maximum: usize,
        admit: impl Fn(&Event) -> bool + Send + Sync,
        stop: CancellationToken,
    ) -> Result<Option<Outcome>> {
        let mut current = self
            .plan
            .try_lock()
            .map_err(|_| conflict("A native publication operation is already running"))?;
        let Some(plan) = current.as_mut() else {
            return Ok(None);
        };
        let identities = plan
            .identities
            .iter()
            .map(|value| {
                coordination::identity(value)
                    .map(|identity| (identity.backend_user_id.clone(), identity))
            })
            .collect::<Result<BTreeMap<_, _>>>()?;
        let mut position = 0;
        while position < plan.steps.len() {
            if stop.is_cancelled() {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Native publication cancelled; original input remains retained",
                ));
            }
            if plan.steps[position].status == Status::Delivered {
                position += 1;
                continue;
            }
            let step = &plan.steps[position];
            let events: Vec<_> = step
                .indices
                .iter()
                .map(|index| plan.batch.events[*index].clone())
                .collect();
            let remaining: Vec<_> = events
                .iter()
                .filter(|event| allowed.contains(&event.room_id) && admit(event))
                .cloned()
                .collect();
            if step.status == Status::Prepared
                && (remaining.len() != events.len() || step.text.len() > maximum)
            {
                let original = step.id.clone();
                let replacement =
                    self.steps(remaining, &identities, &plan.batch.events, maximum)?;
                let retained = replacement.iter().any(|step| step.id == original);
                plan.steps.splice(position..position + 1, replacement);
                self.save(plan)?;
                if !retained {
                    self.artifacts.release(&[original])?;
                }
                continue;
            }
            let selected = self.target(step, stop.clone()).await?;
            let target = selected.as_ref().unwrap_or(self.native.as_ref());
            if step
                .session
                .as_ref()
                .is_some_and(|session| session != target.session_id())
            {
                return Err(conflict("Pending input belongs to another native history"));
            }
            if step.status == Status::Publishing
                && target.recover(&step.text, &step.id, stop.clone()).await?
            {
                plan.steps[position].status = Status::Delivered;
                self.save(plan)?;
                position += 1;
                continue;
            }
            if remaining.len() != events.len() {
                let original = plan.steps[position].id.clone();
                let replacement =
                    self.steps(remaining, &identities, &plan.batch.events, maximum)?;
                let retained = replacement.iter().any(|step| step.id == original);
                plan.steps.splice(position..position + 1, replacement);
                self.save(plan)?;
                if !retained {
                    self.artifacts.release(&[original])?;
                }
                continue;
            }
            if self.priority.is_some() {
                target.settle(stop.clone()).await?;
            }
            let step = &mut plan.steps[position];
            step.session = Some(target.session_id().to_owned());
            step.status = Status::Publishing;
            self.save(plan)?;
            let step = &plan.steps[position];
            target
                .deliver(&step.text, &step.id, stop.clone(), self.priority)
                .await?;
            plan.steps[position].status = Status::Delivered;
            self.save(plan)?;
            position += 1;
        }
        Ok(Self::outcome(plan, allowed))
    }
    fn clear(&self, only: Status) -> Result<()> {
        let mut current = self
            .plan
            .try_lock()
            .map_err(|_| conflict("A native publication operation is already running"))?;
        if let Some(plan) = current.as_ref() {
            if plan.steps.iter().any(|step| step.status != only) {
                return Err(conflict(
                    "Original native evidence must be settled before removing the publication",
                ));
            }
            self.artifacts.release(
                &plan
                    .steps
                    .iter()
                    .map(|step| step.id.clone())
                    .collect::<Vec<_>>(),
            )?;
            self.storage.remove(&self.file)?;
            *current = None;
        }
        Ok(())
    }
    pub fn discard_unpublished(&self) -> Result<()> {
        self.clear(Status::Prepared)
    }
    pub fn acknowledge(&self) -> Result<()> {
        self.clear(Status::Delivered)
    }
}
