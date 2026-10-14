use crate::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Map, Value, json};

#[derive(Debug, Clone, PartialEq)]
pub struct StateEvent {
    pub sender: String,
    pub event_type: String,
    pub state_key: String,
    pub content: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Powers {
    pub owner_level: i64,
    pub ceiling: i64,
    pub ordinary: i64,
    pub message: i64,
    pub reaction: i64,
}

pub fn state(value: &Value) -> Result<Vec<StateEvent>> {
    let events = value
        .as_array()
        .ok_or_else(|| Failure::new(ErrorCode::Native, "Native room state could not be read"))?;
    events
        .iter()
        .map(|event| {
            if !event.is_object() {
                return Err(Failure::new(
                    ErrorCode::Native,
                    "Invalid native state event",
                ));
            }
            let sender = event.get("sender").and_then(Value::as_str);
            let event_type = event.get("type").and_then(Value::as_str);
            let state_key = event.get("state_key").and_then(Value::as_str);
            let content = event.get("content").and_then(Value::as_object);
            match (sender, event_type, state_key, content) {
                (Some(sender), Some(event_type), Some(state_key), Some(content)) => {
                    Ok(StateEvent {
                        sender: sender.to_owned(),
                        event_type: event_type.to_owned(),
                        state_key: state_key.to_owned(),
                        content: content.clone(),
                    })
                }
                _ => Err(Failure::new(
                    ErrorCode::Native,
                    "Invalid native state identity",
                )),
            }
        })
        .collect()
}

pub fn creators(events: &[StateEvent]) -> Result<Vec<String>> {
    let creation = events
        .iter()
        .find(|event| event.event_type == "m.room.create" && event.state_key.is_empty())
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Native,
                "Native room creation state is missing or invalid",
            )
        })?;
    validation::matrix_user_id(&json!(creation.sender)).map_err(|_| {
        Failure::new(
            ErrorCode::Native,
            "Native room creation state is missing or invalid",
        )
    })?;
    if creation.content.get("room_version").and_then(Value::as_str) != Some("12") {
        return Ok(Vec::new());
    }
    let mut identities = vec![creation.sender.clone()];
    if let Some(additional) = creation
        .content
        .get("additional_creators")
        .filter(|value| !value.is_null())
    {
        let entries = additional
            .as_array()
            .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native creator identities"))?;
        for entry in entries {
            let id = validation::matrix_user_id(entry).map_err(|_| {
                Failure::new(ErrorCode::Native, "Invalid native creator identities")
            })?;
            if !identities.iter().any(|identity| identity == id) {
                identities.push(id.to_owned());
            }
        }
    }
    Ok(identities)
}

pub fn owner_conversation(events: &[StateEvent], owner: &str, agent: &str) -> Result<()> {
    let creators = creators(events)?;
    let creation = events
        .iter()
        .find(|event| event.event_type == "m.room.create" && event.state_key.is_empty());
    let join = events
        .iter()
        .find(|event| event.event_type == "m.room.join_rules" && event.state_key.is_empty())
        .and_then(|event| event.content.get("join_rule"))
        .and_then(Value::as_str);
    let history = events
        .iter()
        .find(|event| event.event_type == "m.room.history_visibility" && event.state_key.is_empty())
        .and_then(|event| event.content.get("history_visibility"))
        .and_then(Value::as_str);
    if validation::matrix_user_id(&json!(owner)).is_err()
        || validation::matrix_user_id(&json!(agent)).is_err()
        || owner == agent
        || creation.is_none_or(|event| event.sender != owner)
        || creators.iter().any(|id| id != owner && id != agent)
        || events
            .iter()
            .any(|event| event.event_type == "m.room.encryption")
        || join != Some("invite")
        || history == Some("world_readable")
        || events.iter().any(|event| {
            event.event_type == "m.room.member"
                && matches!(
                    event.content.get("membership").and_then(Value::as_str),
                    Some("join" | "invite")
                )
                && event.state_key != owner
                && event.state_key != agent
        })
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Owner messages require a private unencrypted conversation containing only the owner and this agent",
        ));
    }
    Ok(())
}

pub fn level(value: Option<&Value>, default: i64) -> Result<i64> {
    value.map_or(Ok(default), |value| {
        validation::integer(value, -validation::SAFE_INTEGER, validation::SAFE_INTEGER)
            .map_err(|_| Failure::new(ErrorCode::Native, "Invalid native power level"))
    })
}

pub fn powers(content: &Map<String, Value>, owner: &str) -> Result<Powers> {
    let empty = Map::new();
    let users = content
        .get("users")
        .filter(|value| !value.is_null())
        .map_or(Some(&empty), Value::as_object)
        .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native power-level maps"))?;
    let events = content
        .get("events")
        .filter(|value| !value.is_null())
        .map_or(Some(&empty), Value::as_object)
        .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native power-level maps"))?;
    let defaults = level(content.get("users_default"), 0)?;
    let ordinary = level(content.get("events_default"), 0)?;
    let state = level(content.get("state_default"), 50)?;
    let owner_level = level(users.get(owner), defaults)?;
    let message = level(events.get("m.room.message"), ordinary)?;
    let reaction = level(events.get("m.reaction"), ordinary)?;
    let mut ceiling = state;
    for (field, default) in [("invite", 0), ("kick", 50), ("ban", 50), ("redact", 50)] {
        ceiling = ceiling.min(level(
            content.get(field).filter(|value| !value.is_null()),
            default,
        )?);
    }
    for (name, value) in events {
        if name != "m.room.message" && name != "m.reaction" {
            ceiling = ceiling.min(level(Some(value), 0)?);
        }
    }
    ceiling -= 1;
    if ceiling < -validation::SAFE_INTEGER {
        return Err(Failure::new(
            ErrorCode::Native,
            "Native power ceiling cannot be represented",
        ));
    }
    Ok(Powers {
        owner_level,
        ceiling,
        ordinary,
        message,
        reaction,
    })
}
