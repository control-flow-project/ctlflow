use crate::{
    coordination::Coordination,
    events::{Event, invalid},
    local_state::{self, LocalState},
};
use crossfire_contracts::{call::Call, operations::OperationId, validation as check};
use crossfire_domain::messaging_client::InvitationReader;
use crossfire_kernel::{Result, failure::ErrorCode, time::Clock};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Notice {
    room: String,
    event: String,
}
struct State {
    notices: BTreeMap<(String, String), Notice>,
    invitations: BTreeMap<String, Option<i64>>,
    requested: u64,
    checked: Option<u64>,
    checked_at: Option<i64>,
}
pub struct Options {
    pub file: String,
    pub agent_id: String,
    pub interval_ms: i64,
}
pub struct Maintenance<S, C, T> {
    storage: Arc<S>,
    coordination: Arc<C>,
    clock: T,
    options: Options,
    state: Mutex<State>,
}
impl<S: LocalState, C: Coordination, T: Clock + Send + Sync> Maintenance<S, C, T> {
    pub fn open(storage: Arc<S>, coordination: Arc<C>, clock: T, options: Options) -> Result<Self> {
        if !(1000..=600000).contains(&options.interval_ms) {
            return Err(invalid("Invalid listener reconciliation interval"));
        }
        let saved: Vec<Notice> =
            local_state::read(storage.as_ref(), &options.file, 24 * 1024 * 1024)?
                .unwrap_or_default();
        if saved.len() > 10000 {
            return Err(invalid("Excessive saved blocked-mention notices"));
        }
        let mut notices = BTreeMap::new();
        for value in saved {
            check::room_id(&json!(value.room))?;
            check::event_id(&json!(value.event))?;
            if notices
                .insert((value.room.clone(), value.event.clone()), value)
                .is_some()
            {
                return Err(invalid("Duplicate blocked-mention notice identity"));
            }
        }
        Ok(Self {
            storage,
            coordination,
            clock,
            options,
            state: Mutex::new(State {
                notices,
                invitations: BTreeMap::new(),
                requested: 0,
                checked: None,
                checked_at: None,
            }),
        })
    }
    fn save(&self, state: &State) -> Result<()> {
        if state.notices.is_empty() {
            self.storage.remove(&self.options.file)
        } else {
            local_state::write(
                self.storage.as_ref(),
                &self.options.file,
                &state.notices.values().collect::<Vec<_>>(),
                24 * 1024 * 1024,
            )
        }
    }
    pub fn observe(&self) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Listener maintenance ownership failed"))?;
        state.requested = state.requested.wrapping_add(1);
        Ok(())
    }
    pub fn notice(&self, event: &Event) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Listener maintenance ownership failed"))?;
        let key = (event.room_id.clone(), event.event_id.clone());
        if state.notices.contains_key(&key) {
            return Ok(());
        }
        if state.notices.len() >= 10000 {
            return Err(invalid(
                "Pending blocked-mention notices exceed their bounded capacity",
            ));
        }
        state.notices.insert(
            key,
            Notice {
                room: event.room_id.clone(),
                event: event.event_id.clone(),
            },
        );
        self.save(&state)
    }
    pub async fn publish(
        &self,
        messaging: &impl InvitationReader,
        stop: CancellationToken,
    ) -> Result<bool> {
        let now = self.clock.now()?;
        let (revision, refresh) = {
            let state = self
                .state
                .lock()
                .map_err(|_| invalid("Listener maintenance ownership failed"))?;
            (
                state.requested,
                state.checked != Some(state.requested)
                    || state
                        .checked_at
                        .is_none_or(|at| now.saturating_sub(at) >= self.options.interval_ms),
            )
        };
        let invitations = if refresh {
            Some(messaging.invitation_rooms(stop.clone()).await?)
        } else {
            None
        };
        let selected: Vec<_> = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Listener maintenance ownership failed"))?;
            if let Some(invitations) = &invitations {
                for room in invitations {
                    check::room_id(&json!(room))?;
                }
                state
                    .invitations
                    .retain(|room, _| invitations.contains(room));
                for room in invitations {
                    state.invitations.entry(room.clone()).or_insert(None);
                }
                state.checked = Some(revision);
                state.checked_at = Some(now);
            }
            state
                .invitations
                .iter()
                .filter(|(_, at)| {
                    at.is_none_or(|at| now.saturating_sub(at) >= self.options.interval_ms)
                })
                .take(10)
                .map(|(room, _)| room.clone())
                .collect()
        };
        let mut joined = false;
        for room in selected {
            let mut request =
                Call::agent(OperationId::AcceptRoomInvitation, &self.options.agent_id);
            request.body = Some(json!({"roomId":room}));
            let response = self.coordination.call(&request, stop.clone()).await;
            let accepted = match response {
                Ok(value) => check::boolean(
                    value
                        .get("accepted")
                        .ok_or_else(|| invalid("Invitation reply is missing acceptance"))?,
                )?,
                Err(error)
                    if matches!(
                        error.code,
                        ErrorCode::Forbidden
                            | ErrorCode::Missing
                            | ErrorCode::Conflict
                            | ErrorCode::Limit
                    ) =>
                {
                    false
                }
                Err(error) => return Err(error),
            };
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Listener maintenance ownership failed"))?;
            if accepted {
                state.invitations.remove(&room);
                joined = true;
            } else {
                state.invitations.insert(room, Some(now));
            }
        }
        let notices: Vec<_> = self
            .state
            .lock()
            .map_err(|_| invalid("Listener maintenance ownership failed"))?
            .notices
            .keys()
            .cloned()
            .collect();
        for (room, event) in notices {
            let mut request = Call::agent(OperationId::WakeNotice, &self.options.agent_id);
            request
                .parameters
                .insert("eventId".to_owned(), event.clone());
            request.body = Some(json!({"roomId":room}));
            self.coordination.call(&request, stop.clone()).await?;
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Listener maintenance ownership failed"))?;
            state.notices.remove(&(room, event));
            self.save(&state)?;
        }
        Ok(joined)
    }
}
