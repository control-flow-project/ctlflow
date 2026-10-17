use crate::options;
use crossfire_agent_core::runtime::{Hooks, ObservationEvent};
use crossfire_contracts::{statistics, validation};
use crossfire_domain::{
    runtime::values::{Runtime, Setting, State},
    statistics::{Tokens, Usage},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};

struct Stream {
    id: String,
    bytes: usize,
    digest: Sha256,
}
#[derive(Default)]
struct Tracking {
    session: String,
    settings: Vec<Setting>,
    stream: Option<Stream>,
    tokens: Option<Tokens>,
}
pub struct Observer<H> {
    hooks: Arc<H>,
    tracking: Mutex<Tracking>,
}
fn invalid() -> Failure {
    Failure::new(ErrorCode::Native, "Invalid native Pi observation")
}

fn counts(value: &Value) -> Option<Tokens> {
    let count = |name| validation::integer(value.get(name)?, 0, validation::SAFE_INTEGER).ok();
    let input = count("input")?;
    let cached = count("cacheRead")?;
    let write = count("cacheWrite")?;
    let output = count("output")?;
    let all_input = input.checked_add(cached)?.checked_add(write)?;
    statistics::tokens(&json!({"input":all_input,"cachedInput":cached,"cacheWriteInput":write,"output":output,"reasoningOutput":null,"total":all_input.checked_add(output)?})).ok()
}
fn increment(first: &Tokens, second: &Tokens) -> Option<Tokens> {
    statistics::tokens(&json!({"input":first.input.checked_add(second.input)?,"cachedInput":first.cached_input.checked_add(second.cached_input)?,"cacheWriteInput":first.cache_write_input?.checked_add(second.cache_write_input?)?,"output":first.output.checked_add(second.output)?,"reasoningOutput":null,"total":first.total.checked_add(second.total)?})).ok()
}

impl<H: Hooks> Observer<H> {
    pub fn new(hooks: Arc<H>) -> Self {
        Self {
            hooks,
            tracking: Mutex::new(Tracking::default()),
        }
    }
    pub fn configure(&self, session: &str, settings: Vec<Setting>) -> Result<()> {
        let mut tracking = self.tracking.lock().map_err(|_| invalid())?;
        if !tracking.session.is_empty() && tracking.session != session {
            return Err(invalid());
        }
        tracking.session = session.to_owned();
        tracking.settings = settings;
        Ok(())
    }
    pub fn initialize_usage(&self, value: &Value) -> Result<()> {
        let mut tracking = self.tracking.lock().map_err(|_| invalid())?;
        if value.get("sessionId").and_then(Value::as_str) != Some(tracking.session.as_str()) {
            return Err(invalid());
        }
        tracking.tokens = value.get("tokens").and_then(counts);
        let usage = tracking.tokens.as_ref().map(|tokens| Usage {
            runtime: "pi".to_owned(),
            session_id: tracking.session.clone(),
            tokens: tokens.clone(),
        });
        drop(tracking);
        if let Some(usage) = usage {
            self.hooks.usage(&usage);
        }
        Ok(())
    }
    fn state_event(
        tracking: &Tracking,
        state: State,
        error: Option<&str>,
    ) -> Result<ObservationEvent> {
        Ok(ObservationEvent::State {
            runtime: Runtime::Pi,
            session_id: tracking.session.clone(),
            room_id: None,
            state,
            observed_at: identity::now()?,
            settings: tracking.settings.clone(),
            error_message: error.map(options::error_text),
        })
    }
    pub fn state(&self, state: State, error: Option<&str>) -> Result<()> {
        let tracking = self.tracking.lock().map_err(|_| invalid())?;
        let event = Self::state_event(&tracking, state, error)?;
        drop(tracking);
        self.hooks.observe(event);
        Ok(())
    }
    fn output(
        session: &str,
        id: String,
        text: String,
        stream: Option<String>,
    ) -> Option<ObservationEvent> {
        (!text.is_empty()).then(|| ObservationEvent::Output {
            session_id: session.to_owned(),
            id,
            stream_id: stream,
            text,
        })
    }
    pub fn event(&self, event: &Value) -> Result<()> {
        let event = event.as_object().ok_or_else(invalid)?;
        let kind = event
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let mut tracking = self.tracking.lock().map_err(|_| invalid())?;
        if tracking.session.is_empty() {
            return Ok(());
        }
        let mut sample = None;
        if matches!(kind, "entry_appended" | "message_end") {
            let usage = if kind == "entry_appended" {
                event
                    .get("entry")
                    .filter(|entry| {
                        entry
                            .get("type")
                            .and_then(Value::as_str)
                            .is_some_and(|kind| {
                                ["usage", "compaction", "branch_summary"].contains(&kind)
                            })
                    })
                    .and_then(|entry| entry.get("usage"))
            } else {
                event
                    .get("message")
                    .filter(|message| {
                        message
                            .get("role")
                            .and_then(Value::as_str)
                            .is_some_and(|role| ["assistant", "toolResult"].contains(&role))
                    })
                    .and_then(|message| message.get("usage"))
            };
            if let Some(tokens) = tracking.tokens.as_ref().and_then(|original| {
                usage
                    .and_then(counts)
                    .and_then(|usage| increment(original, &usage))
            }) {
                tracking.tokens = Some(tokens.clone());
                sample = Some(Usage {
                    runtime: "pi".to_owned(),
                    session_id: tracking.session.clone(),
                    tokens,
                });
            }
        }
        let output = match kind {
            "agent_start" | "auto_retry_start" | "auto_compaction_start" => {
                Some(Self::state_event(&tracking, State::Working, None)?)
            }
            "agent_settled" => Some(Self::state_event(&tracking, State::Idle, None)?),
            "message_start" => {
                let message = event
                    .get("message")
                    .and_then(Value::as_object)
                    .ok_or_else(invalid)?;
                if message.get("role").and_then(Value::as_str) == Some("assistant") {
                    tracking.stream = Some(Stream {
                        id: identity::id(),
                        bytes: 0,
                        digest: Sha256::new(),
                    });
                }
                None
            }
            "message_update" => {
                let change = event
                    .get("assistantMessageEvent")
                    .and_then(Value::as_object)
                    .ok_or_else(invalid)?;
                if change.get("type").and_then(Value::as_str) != Some("text_delta") {
                    return Ok(());
                }
                let stream = tracking.stream.as_mut().ok_or_else(invalid)?;
                let delta = change
                    .get("delta")
                    .and_then(Value::as_str)
                    .ok_or_else(invalid)?;
                let id = format!("{}:{}", stream.id, stream.bytes);
                let stream_id = stream.id.clone();
                stream.bytes = stream.bytes.checked_add(delta.len()).ok_or_else(invalid)?;
                stream.digest.update(delta.as_bytes());
                Self::output(&tracking.session, id, delta.to_owned(), Some(stream_id))
            }
            "message_end" => {
                let message = event
                    .get("message")
                    .and_then(Value::as_object)
                    .ok_or_else(invalid)?;
                let role = message
                    .get("role")
                    .and_then(Value::as_str)
                    .ok_or_else(invalid)?;
                if !["assistant", "toolResult"].contains(&role) {
                    None
                } else {
                    let content = message
                        .get("content")
                        .and_then(Value::as_array)
                        .ok_or_else(invalid)?;
                    let mut text = String::new();
                    for part in content {
                        let part = part.as_object().ok_or_else(invalid)?;
                        if part.get("type").and_then(Value::as_str) == Some("text") {
                            text.push_str(
                                part.get("text")
                                    .and_then(Value::as_str)
                                    .ok_or_else(invalid)?,
                            );
                        }
                    }
                    if role == "assistant"
                        && let Some(stream) = tracking.stream.take()
                    {
                        if stream.bytes == 0 {
                            Self::output(&tracking.session, stream.id + ":0", text, None)
                        } else {
                            if stream.bytes != text.len()
                                || stream.digest.finalize() != Sha256::digest(text.as_bytes())
                            {
                                return Err(invalid());
                            }
                            None
                        }
                    } else {
                        Self::output(&tracking.session, identity::id(), text, None)
                    }
                }
            }
            "extension_ui_request"
                if event.get("method").and_then(Value::as_str) == Some("notify") =>
            {
                let text = event
                    .get("message")
                    .and_then(Value::as_str)
                    .ok_or_else(invalid)?;
                let id = event
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(invalid)?;
                Self::output(&tracking.session, id.to_owned(), text.to_owned(), None)
            }
            _ => None,
        };
        drop(tracking);
        if let Some(sample) = sample {
            self.hooks.usage(&sample);
        }
        if let Some(output) = output {
            self.hooks.observe(output);
        }
        Ok(())
    }
}
