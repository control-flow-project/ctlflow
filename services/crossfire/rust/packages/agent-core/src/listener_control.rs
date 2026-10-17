use crate::events::invalid;
use crossfire_contracts::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::sync::Mutex;
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct Binding {
    pub fleet_id: String,
    pub connection_id: String,
    pub credential: Secret,
}
impl Binding {
    pub fn validate(&self) -> Result<()> {
        check::identifier(&json!(self.fleet_id))?;
        check::identifier(&json!(self.connection_id))?;
        check::text(&json!(self.credential.expose()), 1, 1000)?;
        Ok(())
    }
    pub fn value(&self) -> Value {
        json!({"fleetId":self.fleet_id,"connectionId":self.connection_id,"credential":self.credential.expose()})
    }
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub message_id: String,
    pub text: String,
    pub expires_at: i64,
}
impl Input {
    pub fn validate(&self) -> Result<()> {
        check::text(&json!(self.message_id), 1, 200)?;
        check::plain_text(&json!(self.text), 98304)?;
        check::integer(&json!(self.expires_at), 0, check::SAFE_INTEGER)?;
        if self.text.len() > 98304 {
            return Err(invalid("Controller input exceeds its UTF-8 byte bound"));
        }
        Ok(())
    }
}
#[derive(Clone)]
pub struct Snapshot {
    pub active: bool,
    pub generation: CancellationToken,
    pub input: Option<Input>,
    pub binding: Binding,
}
pub struct Control {
    state: Mutex<Snapshot>,
    changed: watch::Sender<u64>,
}
impl Control {
    pub fn new(binding: Binding) -> Result<Self> {
        binding.validate()?;
        let generation = CancellationToken::new();
        generation.cancel();
        let (changed, _) = watch::channel(0);
        Ok(Self {
            state: Mutex::new(Snapshot {
                active: false,
                generation,
                input: None,
                binding,
            }),
            changed,
        })
    }
    pub fn current(&self) -> Result<Snapshot> {
        Ok(self
            .state
            .lock()
            .map_err(|_| invalid("Controller delivery ownership failed"))?
            .clone())
    }
    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.changed.subscribe()
    }
    pub fn update(&self, active: bool, input: Option<Input>, binding: Binding) -> Result<()> {
        binding.validate()?;
        if let Some(input) = &input {
            input.validate()?;
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Controller delivery ownership failed"))?;
        let rebound = state.binding.connection_id != binding.connection_id
            || state.binding.fleet_id != binding.fleet_id
            || state.binding.credential.expose() != binding.credential.expose();
        let changed = state.active != active || state.input != input || rebound;
        if state.active && (!active || rebound) {
            state.generation.cancel();
        }
        if active && (!state.active || rebound) {
            state.generation = CancellationToken::new();
        }
        state.active = active;
        state.input = input;
        state.binding = binding;
        if changed {
            self.changed
                .send_modify(|revision| *revision = revision.wrapping_add(1));
        }
        Ok(())
    }
    pub fn unavailable(&self) -> Result<()> {
        let current = self.current()?;
        self.update(false, current.input, current.binding)
    }
    pub async fn wait(&self, stop: CancellationToken) -> Result<()> {
        let mut changed = self.subscribe();
        loop {
            if stop.is_cancelled() {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Controller activation cancelled",
                ));
            }
            if self.current()?.active {
                return Ok(());
            }
            tokio::select! { biased; _ = stop.cancelled() => return Err(Failure::new(ErrorCode::Unavailable, "Controller activation cancelled")),
            next = changed.changed() => next.map_err(|_| invalid("Controller activation channel closed"))?, }
        }
    }
}
