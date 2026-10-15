use crate::{
    coordination::Coordination,
    events::{Event, invalid},
    local_state::{self, LocalState},
    matrix::Matrix,
    origins,
    profile::Profile,
    runtime::{Admission, InputPriority, InterruptResult, TurnControl},
    steering,
};
use crossfire_contracts::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::BTreeSet, sync::Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Interrupting,
    Interrupted,
    Delivered,
    Superseded,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Control {
    pub room: String,
    pub event: String,
    pub stop: bool,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub turn: Option<String>,
    pub status: Stage,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct State {
    pub thread: String,
    pub paused: bool,
    pub controls: Vec<Control>,
}
pub trait Notices: Send + Sync {
    fn stage(&self, event: &Event, stage: &str, detail: Option<&str>) -> Result<()>;
    fn superseded(&self, previous: &Control, replacement: &Event) -> Result<()>;
}
pub struct Controls<S> {
    storage: S,
    file: String,
    state: Mutex<State>,
}
impl<S: LocalState> Controls<S> {
    pub fn open(storage: S, file: &str, thread: &str) -> Result<Self> {
        let state: State = local_state::read(&storage, file, 1048576)?.unwrap_or_else(|| State {
            thread: thread.to_owned(),
            paused: false,
            controls: Vec::new(),
        });
        if state.thread != thread || state.controls.len() > 1000 {
            return Err(invalid("Invalid or different-history source control state"));
        }
        let mut identities = BTreeSet::new();
        for control in &state.controls {
            check::room_id(&json!(control.room))?;
            check::event_id(&json!(control.event))?;
            if let Some(turn) = &control.turn {
                check::text(&json!(turn), 1, 255)?;
            }
            if !identities.insert((&control.room, &control.event)) {
                return Err(invalid("Duplicate retained source control"));
            }
        }
        Ok(Self {
            storage,
            file: file.to_owned(),
            state: Mutex::new(state),
        })
    }
    fn save(&self, state: &State) -> Result<()> {
        local_state::write(&self.storage, &self.file, state, 1048576)
    }
    pub fn contains(&self, event: &Event) -> Result<bool> {
        Ok(self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?
            .controls
            .iter()
            .any(|control| control.room == event.room_id && control.event == event.event_id))
    }
    pub fn resume(&self) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?;
        state.paused = false;
        self.save(&state)
    }
    pub fn retire(&self, rooms: &BTreeSet<String>) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?;
        state
            .controls
            .retain(|control| !rooms.contains(&control.room));
        self.save(&state)
    }
    pub fn paused(&self) -> Result<bool> {
        Ok(self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?
            .paused)
    }
    pub fn urgent(&self) -> Result<Option<Control>> {
        Ok(self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?
            .controls
            .iter()
            .rev()
            .find(|control| control.status == Stage::Interrupted)
            .cloned())
    }
    pub fn pending(&self) -> Result<bool> {
        Ok(self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?
            .controls
            .iter()
            .any(|control| matches!(control.status, Stage::Interrupting | Stage::Interrupted)))
    }
    pub fn interrupting(&self) -> Result<bool> {
        Ok(self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?
            .controls
            .iter()
            .any(|control| control.status == Stage::Interrupting))
    }
    pub fn accepts(&self, event: &Event) -> Result<bool> {
        Ok(!self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?
            .controls
            .iter()
            .any(|control| {
                control.room == event.room_id
                    && control.event == event.event_id
                    && control.status == Stage::Delivered
            }))
    }
    pub fn accepted(&self, events: &[Event], notices: &impl Notices) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?;
        for event in events {
            if let Some(control) = state
                .controls
                .iter_mut()
                .find(|control| control.room == event.room_id && control.event == event.event_id)
                && control.status != Stage::Delivered
            {
                notices.stage(event, "accepted", None)?;
                control.status = Stage::Delivered;
            }
        }
        self.save(&state)
    }
    pub fn supersede(&self, original: &Control) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?;
        if let Some(control) = state
            .controls
            .iter_mut()
            .find(|control| control.room == original.room && control.event == original.event)
        {
            control.status = Stage::Superseded;
        }
        self.save(&state)
    }
    pub fn checkpoint(&self, events: &[Event]) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?;
        state.controls.retain(|control| {
            !matches!(control.status, Stage::Delivered | Stage::Superseded)
                || !events
                    .iter()
                    .any(|event| event.room_id == control.room && event.event_id == control.event)
        });
        self.save(&state)
    }
    pub async fn recover(&self, native: &impl TurnControl, stop: CancellationToken) -> Result<()> {
        let pending: Vec<_> = self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?
            .controls
            .iter()
            .filter(|control| control.status == Stage::Interrupting)
            .cloned()
            .collect();
        for original in pending {
            if let Some(turn) = &original.turn {
                native
                    .interrupt(
                        turn,
                        true,
                        Some(&Admission {
                            priority: InputPriority::Steering,
                            cancellation: stop.clone(),
                        }),
                    )
                    .await?;
            }
            self.interrupted(&original)?;
        }
        Ok(())
    }
    fn interrupted(&self, original: &Control) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Source control ownership failed"))?;
        let control = state
            .controls
            .iter_mut()
            .find(|control| control.room == original.room && control.event == original.event)
            .ok_or_else(|| invalid("Captured source control is missing"))?;
        control.status = if original.stop {
            Stage::Delivered
        } else {
            Stage::Interrupted
        };
        state.paused = original.stop;
        self.save(&state)
    }
    pub async fn interrupt(
        &self,
        input: Interrupt<'_, impl Matrix, impl Coordination, impl TurnControl, impl Notices>,
        stop: CancellationToken,
    ) -> Result<bool> {
        let event = origins::enrich(
            input.matrix,
            &input.profile.account.user_id,
            vec![input.event],
            stop.clone(),
        )
        .await?
        .pop()
        .ok_or_else(|| invalid("Original steering event is missing"))?;
        input.notices.stage(&event, "received", None)?;
        let admission = Admission {
            priority: InputPriority::Steering,
            cancellation: stop.clone(),
        };
        let turn = input
            .native
            .active_turn(input.per_room.then_some(&event.room_id), Some(&admission))
            .await?;
        if !input.allowed.contains(&event.room_id)
            || !steering::authorized(
                input.matrix,
                input.coordination,
                input.profile,
                &event,
                input.senders,
                stop.clone(),
            )
            .await?
        {
            input.notices.stage(
                &event,
                "failed",
                Some("Source or room authority changed before cancellation"),
            )?;
            return Ok(false);
        }
        let original = Control {
            room: event.room_id.clone(),
            event: event.event_id.clone(),
            stop: event.sender == input.profile.settings.owner
                && event.content["body"]
                    .as_str()
                    .is_some_and(|body| body.trim() == "!!"),
            turn,
            status: Stage::Interrupting,
        };
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Source control ownership failed"))?;
            if state.controls.len() >= 1000 {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Uncheckpointed source controls exceed their capacity; original history remains unread",
                ));
            }
            for control in &mut state.controls {
                if control.status == Stage::Interrupted
                    && (!input.per_room || control.room == event.room_id)
                {
                    input.notices.superseded(control, &event)?;
                    control.status = Stage::Superseded;
                }
            }
            state.controls.push(original.clone());
            self.save(&state)?;
        }
        let outcome = match &original.turn {
            Some(turn) => input.native.interrupt(turn, false, Some(&admission)).await,
            None => Ok(InterruptResult::Inactive),
        };
        match outcome {
            Ok(outcome) => {
                input.notices.stage(
                    &event,
                    if outcome == InterruptResult::Interrupted {
                        "interrupted"
                    } else {
                        "already-idle"
                    },
                    None,
                )?;
                self.interrupted(&original)?;
                Ok(true)
            }
            Err(error) => {
                input
                    .notices
                    .stage(&event, "failed", Some(&error.message))?;
                Err(error)
            }
        }
    }
}
pub struct Interrupt<'a, M, C, N, R> {
    pub matrix: &'a M,
    pub coordination: &'a C,
    pub native: &'a N,
    pub notices: &'a R,
    pub profile: &'a Profile,
    pub event: Event,
    pub allowed: &'a BTreeSet<String>,
    pub senders: &'a BTreeSet<String>,
    pub per_room: bool,
}
