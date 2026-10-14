use crate::{protocol::Event, usage};
use crossfire_agent_core::runtime::{Hooks, ObservationEvent};
use crossfire_contracts::validation::truncate_utf16;
use crossfire_domain::runtime::values::{Runtime, Setting, State};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

struct Stream {
    length: usize,
    digest: Sha256,
}
#[derive(Default)]
struct Tracking {
    streamed: HashMap<String, Stream>,
    offsets: HashMap<String, usize>,
    settings: Vec<Setting>,
}

pub struct Observer<H> {
    hooks: Arc<H>,
    state: Mutex<Tracking>,
}

fn invalid() -> Failure {
    Failure::new(ErrorCode::Native, "Invalid native Codex observation")
}
fn field<'a>(value: &'a Map<String, Value>, name: &str) -> Result<&'a Value> {
    value.get(name).ok_or_else(invalid)
}
fn string<'a>(value: &'a Map<String, Value>, name: &str) -> Result<&'a str> {
    field(value, name)?.as_str().ok_or_else(invalid)
}
fn object(value: &Value) -> Result<&Map<String, Value>> {
    value.as_object().ok_or_else(invalid)
}
fn optional_string<'a>(value: &'a Map<String, Value>, name: &str) -> Result<Option<&'a str>> {
    match field(value, name)? {
        Value::Null => Ok(None),
        Value::String(value) => Ok(Some(value)),
        _ => Err(invalid()),
    }
}
fn optional_array(value: &Map<String, Value>, name: &str) -> Result<()> {
    if field(value, name)?.is_null() || field(value, name)?.is_array() {
        Ok(())
    } else {
        Err(invalid())
    }
}

fn validate_item(item: &Map<String, Value>) -> Result<()> {
    if string(item, "id")?.is_empty() {
        return Err(invalid());
    }
    match string(item, "type")? {
        "agentMessage" => {
            string(item, "text")?;
        }
        "commandExecution" => {
            string(item, "command")?;
            string(item, "cwd")?;
            optional_string(item, "aggregatedOutput")?;
        }
        "fileChange" => {
            field(item, "changes")?;
        }
        "mcpToolCall" => {
            string(item, "tool")?;
            field(item, "result")?;
            field(item, "error")?;
        }
        "dynamicToolCall" => {
            string(item, "tool")?;
            optional_array(item, "contentItems")?;
            let success = field(item, "success")?;
            if !success.is_null() && !success.is_boolean() {
                return Err(invalid());
            }
        }
        "webSearch" => {
            string(item, "query")?;
            field(item, "action")?;
            optional_array(item, "results")?;
        }
        "imageGeneration" => {
            string(item, "status")?;
            optional_string(item, "revisedPrompt")?;
            string(item, "result")?;
            field(item, "failure")?;
        }
        _ => return Err(invalid()),
    }
    Ok(())
}

fn hash_utf16(digest: &mut Sha256, value: &str) {
    for unit in value.encode_utf16() {
        digest.update(unit.to_le_bytes());
    }
}
fn setting(value: Option<&Value>) -> Option<String> {
    value.filter(|value| !value.is_null()).map(|value| {
        value
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| value.to_string())
    })
}

impl<H: Hooks> Observer<H> {
    pub fn new(hooks: Arc<H>) -> Self {
        Self {
            hooks,
            state: Mutex::new(Tracking::default()),
        }
    }

    pub fn configure(
        &self,
        configured: &Value,
        selected: &Value,
        version: Option<&str>,
    ) -> Result<()> {
        let configured = object(configured)?;
        let selected = object(selected)?;
        let effective = [
            ("model", selected.get("model")),
            ("model_reasoning_effort", selected.get("reasoningEffort")),
            (
                "sandbox_mode",
                selected.get("sandbox").and_then(|value| value.get("type")),
            ),
            ("approval_policy", selected.get("approvalPolicy")),
        ];
        let mut settings = effective
            .into_iter()
            .map(|(name, value)| Setting {
                name: name.to_owned(),
                configured: setting(configured.get(name)),
                effective: setting(value),
            })
            .collect::<Vec<_>>();
        settings.push(Setting {
            name: "native_version".to_owned(),
            configured: setting(configured.get("native_version")),
            effective: version.map(str::to_owned),
        });
        if let Some(Value::Object(features)) = configured.get("features") {
            for (name, value) in features {
                settings.push(Setting {
                    name: "features.".to_owned() + name,
                    configured: setting(Some(value)),
                    effective: None,
                });
            }
        }
        self.state.lock().map_err(|_| invalid())?.settings = settings;
        Ok(())
    }

    fn state_event(
        state: &Tracking,
        session: &str,
        value: State,
        error_message: Option<String>,
    ) -> Result<ObservationEvent> {
        Ok(ObservationEvent::State {
            runtime: Runtime::Codex,
            session_id: session.to_owned(),
            room_id: None,
            state: value,
            observed_at: identity::now()?,
            settings: state.settings.clone(),
            error_message,
        })
    }

    pub fn state(&self, session: &str, value: State, message: Option<&str>) -> Result<()> {
        let tracking = self.state.lock().map_err(|_| invalid())?;
        let event = Self::state_event(
            &tracking,
            session,
            value,
            message.map(|value| truncate_utf16(value, 4000).to_owned()),
        )?;
        drop(tracking);
        self.hooks.observe(event);
        Ok(())
    }

    fn output(
        state: &mut Tracking,
        session: &str,
        id: &str,
        value: &str,
        stream: Option<&str>,
    ) -> Result<Option<ObservationEvent>> {
        if value.is_empty() {
            return Ok(None);
        }
        let offset = state.offsets.entry(id.to_owned()).or_default();
        let identity = format!("{id}:{offset}");
        *offset = offset.checked_add(value.len()).ok_or_else(invalid)?;
        Ok(Some(ObservationEvent::Output {
            session_id: session.to_owned(),
            id: identity,
            stream_id: stream.map(str::to_owned),
            text: value.to_owned(),
        }))
    }

    fn completed(
        state: &mut Tracking,
        session: &str,
        item: &Map<String, Value>,
    ) -> Result<Option<ObservationEvent>> {
        let kind = string(item, "type")?;
        let id = string(item, "id")?;
        if id.is_empty() {
            return Err(invalid());
        }
        let complete = match kind {
            "agentMessage" => Some(string(item, "text")?),
            "commandExecution" => {
                string(item, "command")?;
                string(item, "cwd")?;
                optional_string(item, "aggregatedOutput")?
            }
            _ => None,
        };
        if let Some(complete) = complete {
            let prefix = state.streamed.remove(id);
            let byte_offset = prefix.as_ref().and_then(|prefix| {
                let mut units = 0usize;
                let offset = complete
                    .char_indices()
                    .find_map(|(offset, character)| {
                        if units == prefix.length {
                            Some(offset)
                        } else {
                            units += character.len_utf16();
                            None
                        }
                    })
                    .or_else(|| (units == prefix.length).then_some(complete.len()))?;
                let mut digest = Sha256::new();
                hash_utf16(&mut digest, &complete[..offset]);
                (digest.finalize() == prefix.digest.clone().finalize()).then_some(offset)
            });
            return Self::output(
                state,
                session,
                id,
                &complete[byte_offset.unwrap_or(0)..],
                Some(id),
            );
        }
        state.streamed.remove(id);
        let contents = match kind {
            "fileChange" => serde_json::to_string_pretty(field(item, "changes")?),
            "mcpToolCall" => { let tool = string(item, "tool")?; serde_json::to_string(&json!({"tool":tool,"result":field(item, "result")?,"error":field(item, "error")?})) },
            "dynamicToolCall" => {
                let tool = string(item, "tool")?; optional_array(item, "contentItems")?;
                if !field(item, "success")?.is_null() && !field(item, "success")?.is_boolean() { return Err(invalid()); }
                serde_json::to_string(&json!({"tool":tool,"contentItems":field(item,"contentItems")?,"success":field(item,"success")?}))
            },
            "webSearch" => {
                let query = string(item, "query")?; optional_array(item, "results")?;
                serde_json::to_string(&json!({"tool":kind,"query":query,"action":field(item,"action")?,"results":field(item,"results")?}))
            },
            "imageGeneration" => {
                let status = string(item, "status")?; let prompt = optional_string(item, "revisedPrompt")?; let result = string(item, "result")?;
                serde_json::to_string(&json!({"tool":kind,"status":status,"revisedPrompt":prompt,"result":result,"failure":field(item,"failure")?}))
            },
            _ => return Ok(None),
        }.map_err(|_| invalid())?;
        Self::output(state, session, id, &contents, None)
    }

    pub fn event(&self, event: &Event, session: &str) -> Result<()> {
        if event.params.get("threadId").and_then(Value::as_str) != Some(session) {
            return Ok(());
        }
        if let Some(usage) = usage::sample(event, session) {
            self.hooks.usage(&usage);
        }
        let mut state = self.state.lock().map_err(|_| invalid())?;
        let params = &event.params;
        let output = match event.method.as_str() {
            "thread/status/changed" => {
                let status = object(field(params, "status")?)?;
                let value = match string(status, "type")? {
                    "idle" => State::Idle,
                    "notLoaded" | "systemError" => State::Unavailable,
                    "active" => {
                        let flags = field(status, "activeFlags")?
                            .as_array()
                            .ok_or_else(invalid)?;
                        if flags.iter().any(|value| {
                            !value.as_str().is_some_and(|value| {
                                ["waitingOnApproval", "waitingOnUserInput"].contains(&value)
                            })
                        }) {
                            return Err(invalid());
                        }
                        if flags.iter().any(|value| value == "waitingOnApproval") {
                            State::WaitingApproval
                        } else if flags.iter().any(|value| value == "waitingOnUserInput") {
                            State::WaitingAnswer
                        } else {
                            State::Working
                        }
                    }
                    _ => return Err(invalid()),
                };
                Some(Self::state_event(&state, session, value, None)?)
            }
            "turn/started" => Some(Self::state_event(&state, session, State::Working, None)?),
            "turn/completed" => {
                let turn = object(field(params, "turn")?)?;
                let native = string(turn, "status")?;
                if !["completed", "failed", "interrupted"].contains(&native) {
                    return Err(invalid());
                }
                let error = match field(turn, "error")? {
                    Value::Null => None,
                    value => {
                        Some(truncate_utf16(string(object(value)?, "message")?, 4000).to_owned())
                    }
                };
                state.streamed.clear();
                state.offsets.clear();
                Some(Self::state_event(
                    &state,
                    session,
                    if native == "failed" {
                        State::Failed
                    } else {
                        State::Idle
                    },
                    error,
                )?)
            }
            "item/agentMessage/delta" | "item/commandExecution/outputDelta" => {
                let id = string(params, "itemId")?;
                let delta = string(params, "delta")?;
                let stream = state
                    .streamed
                    .entry(id.to_owned())
                    .or_insert_with(|| Stream {
                        length: 0,
                        digest: Sha256::new(),
                    });
                stream.length = stream
                    .length
                    .checked_add(delta.encode_utf16().count())
                    .ok_or_else(invalid)?;
                hash_utf16(&mut stream.digest, delta);
                Self::output(&mut state, session, id, delta, Some(id))?
            }
            "item/mcpToolCall/progress" => Self::output(
                &mut state,
                session,
                string(params, "itemId")?,
                string(params, "message")?,
                Some(string(params, "itemId")?),
            )?,
            "item/started" | "item/completed" => {
                let item = object(field(params, "item")?)?;
                let kind = string(item, "type")?;
                if ![
                    "agentMessage",
                    "commandExecution",
                    "fileChange",
                    "mcpToolCall",
                    "dynamicToolCall",
                    "webSearch",
                    "imageGeneration",
                ]
                .contains(&kind)
                {
                    return Ok(());
                }
                validate_item(item)?;
                if event.method == "item/completed" {
                    Self::completed(&mut state, session, item)?
                } else if kind == "commandExecution" {
                    let id = string(item, "id")?;
                    if id.is_empty() {
                        return Err(invalid());
                    }
                    optional_string(item, "aggregatedOutput")?;
                    let value = serde_json::to_string(
                        &json!({"command":string(item, "command")?, "cwd":string(item,"cwd")?}),
                    )
                    .map_err(|_| invalid())?;
                    Self::output(
                        &mut state,
                        session,
                        &(id.to_owned() + ":command"),
                        &value,
                        None,
                    )?
                } else {
                    None
                }
            }
            _ => None,
        };
        drop(state);
        if let Some(output) = output {
            self.hooks.observe(output);
        }
        Ok(())
    }
}
