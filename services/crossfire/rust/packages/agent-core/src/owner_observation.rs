use crate::{
    coordination::Coordination,
    events::invalid,
    local_state::{self, LocalState},
    matrix::{self, API, Matrix, Request},
    owner_authority, owner_notices,
    profile::Profile,
    runtime::{ObservationEvent, SessionState},
};
use crossfire_contracts::{
    call::Call,
    operations::{Method, OperationId},
    origin::segment,
    runtime as wire,
};
use crossfire_domain::runtime::values::{HistoryMode, State};
use crossfire_kernel::{Result, failure::ErrorCode, time::Clock};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};
use tokio::sync::{Mutex as AsyncMutex, watch};
use tokio_util::sync::CancellationToken;

const JOURNAL_BYTES: usize = 64 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Output {
    id: String,
    text: String,
    sources: Vec<String>,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    stream_id: Option<String>,
    sealed: bool,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    output: Vec<Output>,
    observations: Vec<Value>,
}
struct StateJournal {
    journal: Journal,
    sources: BTreeSet<String>,
    latest: BTreeMap<String, Value>,
    active: BTreeMap<String, bool>,
    last_activity: Option<i64>,
    delivered: Option<(String, String, i64)>,
    publishing: bool,
    run: Option<String>,
}
pub struct Observer<S, C, M, T> {
    storage: Arc<S>,
    coordination: Arc<C>,
    matrix: Arc<M>,
    clock: T,
    profile: Profile,
    file: String,
    history_mode: HistoryMode,
    state: Mutex<StateJournal>,
    publication: AsyncMutex<()>,
    typing: AsyncMutex<()>,
    reporting: watch::Receiver<Option<String>>,
}
pub struct Options {
    pub profile: Profile,
    pub file: String,
    pub history_mode: HistoryMode,
}
impl<S: LocalState, C: Coordination, M: Matrix, T: Clock + Send + Sync> owner_notices::Sink
    for Observer<S, C, M, T>
{
    fn notice(&self, identity: &str, text: &str) -> Result<()> {
        Observer::notice(self, identity, text)
    }
}
impl<S: LocalState, C: Coordination, M: Matrix, T: Clock + Send + Sync> Observer<S, C, M, T> {
    pub fn open(
        storage: Arc<S>,
        coordination: Arc<C>,
        matrix: Arc<M>,
        clock: T,
        options: Options,
        reporting: watch::Receiver<Option<String>>,
    ) -> Result<Self> {
        let journal = local_state::read::<Journal>(storage.as_ref(), &options.file, JOURNAL_BYTES)?
            .unwrap_or_default();
        let mut sources = BTreeSet::new();
        for output in &journal.output {
            if output.id.is_empty()
                || output.text.len() > owner_notices::BYTES
                || output.sources.is_empty()
                || output
                    .sources
                    .iter()
                    .any(|source| source.is_empty() || !sources.insert(source.clone()))
            {
                return Err(invalid(
                    "Invalid owner observation journal; retained state requires owner inspection",
                ));
            }
        }
        let mut latest = BTreeMap::new();
        let mut last_activity = None;
        for value in &journal.observations {
            let observation = wire::observation(value)?;
            last_activity = last_activity.max(observation.last_activity_at);
            latest.insert(observation.session_id, value.clone());
        }
        Ok(Self {
            storage,
            coordination,
            matrix,
            clock,
            profile: options.profile,
            file: options.file,
            history_mode: options.history_mode,
            state: Mutex::new(StateJournal {
                journal,
                sources,
                latest,
                active: BTreeMap::new(),
                last_activity,
                delivered: None,
                publishing: false,
                run: None,
            }),
            publication: AsyncMutex::new(()),
            typing: AsyncMutex::new(()),
            reporting,
        })
    }
    fn save(&self, state: &StateJournal) -> Result<()> {
        local_state::write(
            self.storage.as_ref(),
            &self.file,
            &state.journal,
            JOURNAL_BYTES,
        )
    }
    pub fn busy(&self) -> Result<bool> {
        Ok(self
            .state
            .lock()
            .map_err(|_| invalid("Observation ownership failed"))?
            .active
            .values()
            .any(|busy| *busy))
    }
    pub fn notice(&self, identity: &str, text: &str) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Observation ownership failed"))?;
        for (position, text) in owner_notices::chunks(text).enumerate() {
            let id = owner_notices::identity(&json!(["listener-notice", identity, position]))?;
            if state.sources.insert(id.clone()) {
                state.journal.output.push(Output {
                    id: id.clone(),
                    text: text.to_owned(),
                    sources: vec![id],
                    stream_id: None,
                    sealed: true,
                });
            }
        }
        self.save(&state)
    }
    pub fn observe(
        &self,
        event: ObservationEvent,
        maximum: usize,
        native: Option<SessionState>,
    ) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Observation ownership failed"))?;
        match event {
            ObservationEvent::State {
                runtime,
                session_id,
                room_id,
                state: observed_state,
                observed_at,
                settings,
                error_message,
            } => {
                let busy = matches!(
                    observed_state,
                    State::Working | State::WaitingApproval | State::WaitingAnswer
                );
                state.active.insert(session_id.clone(), busy);
                if busy {
                    state.last_activity = Some(self.clock.now()?);
                }
                let value = json!({"sessionId":session_id,"roomId":room_id,"runtime":runtime.code(),"state":observed_state.code(),"observedAt":observed_at,
                    "lastActivityAt":native.as_ref().and_then(|native| native.last_activity_at).or(state.last_activity),"historyAvailable":native.map(|native| native.history_available),
                    "historyMode":self.history_mode.code(),"maxInputBytes":maximum,"settings":settings.iter().map(|setting| json!({"name":setting.name,"configured":setting.configured,"effective":setting.effective})).collect::<Vec<_>>(),"errorMessage":error_message});
                wire::observation(&value)?;
                let can_replace = state.journal.observations.last().is_some_and(|previous| {
                    previous["sessionId"] == value["sessionId"]
                        && previous["state"] == value["state"]
                        && observed_state != State::Failed
                }) && (!state.publishing || state.journal.observations.len() > 1);
                if can_replace {
                    state.journal.observations.pop();
                }
                state.latest.insert(session_id, value.clone());
                state.journal.observations.push(value);
            }
            ObservationEvent::Output {
                session_id,
                id,
                stream_id,
                text,
            } => {
                state.last_activity = Some(self.clock.now()?);
                let stream = stream_id.map(|stream| json!([session_id, stream]).to_string());
                for (position, part) in owner_notices::chunks(&text).enumerate() {
                    let source = owner_notices::identity(&json!([session_id, id, position]))?;
                    if !state.sources.insert(source.clone()) {
                        continue;
                    }
                    if let Some(previous) = state.journal.output.last_mut()
                        && stream.is_some()
                        && previous.stream_id == stream
                        && !previous.sealed
                        && previous.text.len() + part.len() <= owner_notices::BYTES
                    {
                        previous.text.push_str(part);
                        previous.sources.push(source);
                    } else {
                        state.journal.output.push(Output {
                            id: source.clone(),
                            text: part.to_owned(),
                            sources: vec![source],
                            stream_id: stream.clone(),
                            sealed: false,
                        });
                    }
                }
            }
        }
        self.save(&state)
    }
    async fn typing(&self, room: &str, enabled: bool, stop: CancellationToken) -> Result<()> {
        let mut request = Request::new(
            Method::Put,
            format!(
                "{API}/rooms/{}/typing/{}",
                segment(room),
                segment(&self.profile.account.user_id)
            ),
        );
        request.body = Some(if enabled {
            json!({"typing":true,"timeout":30000})
        } else {
            json!({"typing":false})
        });
        matrix::request(self.matrix.as_ref(), &request, stop).await?;
        Ok(())
    }
    pub async fn delivered(
        &self,
        room: &str,
        session: &str,
        stop: CancellationToken,
    ) -> Result<()> {
        let _owner = self.typing.lock().await;
        let previous = {
            self.state
                .lock()
                .map_err(|_| invalid("Observation ownership failed"))?
                .delivered
                .take()
        };
        if let Some((previous, _, _)) = previous {
            self.typing(&previous, false, stop.clone()).await?;
        }
        let busy = self
            .state
            .lock()
            .map_err(|_| invalid("Observation ownership failed"))?
            .active
            .get(session)
            .copied()
            .unwrap_or(false);
        if busy {
            self.state
                .lock()
                .map_err(|_| invalid("Observation ownership failed"))?
                .delivered = Some((room.to_owned(), session.to_owned(), self.clock.now()?));
            self.typing(room, true, stop).await?;
        }
        Ok(())
    }
    async fn clear_inactive_typing(&self, force: bool, stop: CancellationToken) -> Result<()> {
        let _owner = self.typing.lock().await;
        let room = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Observation ownership failed"))?;
            let Some((_, session, started)) = &state.delivered else {
                return Ok(());
            };
            if !force
                && state.active.get(session) == Some(&true)
                && self.clock.now()?.saturating_sub(*started) < 30000
            {
                return Ok(());
            }
            state.delivered.take().map(|(room, _, _)| room)
        };
        if let Some(room) = room {
            self.typing(&room, false, stop).await?;
        }
        Ok(())
    }
    pub async fn flush(&self, stop: CancellationToken) -> Result<()> {
        let _owner = self.publication.lock().await;
        self.clear_inactive_typing(false, stop.clone()).await?;
        let Some(run) = self.reporting.borrow().clone() else {
            return Ok(());
        };
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Observation ownership failed"))?;
            if state.run.as_ref() != Some(&run) {
                let missing: Vec<_> = state
                    .latest
                    .values()
                    .filter(|value| {
                        !state
                            .journal
                            .observations
                            .iter()
                            .any(|pending| pending == *value)
                    })
                    .cloned()
                    .collect();
                state.journal.observations.extend(missing);
                state.run = Some(run.clone());
                self.save(&state)?;
            }
        }
        loop {
            let pending = {
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| invalid("Observation ownership failed"))?;
                let pending = state.journal.observations.first().cloned();
                state.publishing = pending.is_some();
                pending
            };
            let Some(pending) = pending else {
                break;
            };
            let mut call = Call::agent(OperationId::ReportRuntime, &self.profile.id);
            call.parameters.insert("runId".to_owned(), run.clone());
            call.body = Some(pending);
            let result = self.coordination.call(&call, stop.clone()).await;
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Observation ownership failed"))?;
            state.publishing = false;
            if let Err(error) = result
                && error.code != ErrorCode::Conflict
            {
                return Err(error);
            }
            state.journal.observations.remove(0);
            self.save(&state)?;
        }
        loop {
            let output = {
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| invalid("Observation ownership failed"))?;
                let Some(output) = state.journal.output.first_mut() else {
                    break;
                };
                output.sealed = true;
                let output = output.clone();
                self.save(&state)?;
                output
            };
            let room = owner_authority::conversation(
                self.coordination.as_ref(),
                self.matrix.as_ref(),
                &self.profile,
                stop.clone(),
            )
            .await?;
            let mut send = Request::new(
                Method::Put,
                format!(
                    "{API}/rooms/{}/send/m.room.message/observation-{}",
                    segment(&room),
                    output.id
                ),
            );
            send.body = Some(owner_notices::content(&output.text));
            matrix::request(self.matrix.as_ref(), &send, stop.clone()).await?;
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Observation ownership failed"))?;
            if state
                .journal
                .output
                .first()
                .is_none_or(|pending| pending.id != output.id)
            {
                return Err(invalid(
                    "Owner output publication lost its original identity",
                ));
            }
            state.journal.output.remove(0);
            for source in output.sources {
                state.sources.remove(&source);
            }
            self.save(&state)?;
        }
        Ok(())
    }
    pub async fn close(&self, stop: CancellationToken) -> Result<()> {
        let cleared = self.clear_inactive_typing(true, stop.clone()).await;
        let flushed = self.flush(stop).await;
        cleared.and(flushed)
    }
}
