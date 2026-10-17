use crate::validation;
use crossfire_domain::matrix::MatrixEvent;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};

pub const LISTENER_NOTICE: &str = "org.crossfire.listener_notice";

pub fn listener_notice(event_type: &str, content: &serde_json::Map<String, Value>) -> bool {
    event_type == "m.room.message"
        && content.get("msgtype").and_then(Value::as_str) == Some("m.notice")
        && content.get(LISTENER_NOTICE) == Some(&Value::Bool(true))
}

pub fn event(value: &Value, room: &str, expected: &str) -> Result<MatrixEvent> {
    validation::room_id(&json!(room))?;
    validation::event_id(&json!(expected))?;
    let content = value
        .get("content")
        .and_then(Value::as_object)
        .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native event"))?;
    let sender = value
        .get("sender")
        .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native event"))?;
    let sender = validation::matrix_user_id(sender)
        .map_err(|_| Failure::new(ErrorCode::Native, "Invalid native event"))?;
    let event_type = value
        .get("type")
        .and_then(Value::as_str)
        .filter(|_| value.get("event_id").and_then(Value::as_str) == Some(expected))
        .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native event"))?;
    let mentions = content
        .get("m.mentions")
        .and_then(Value::as_object)
        .and_then(|mentions| mentions.get("user_ids"))
        .and_then(Value::as_array);
    let mentions = mentions
        .into_iter()
        .flatten()
        .map(|identity| {
            validation::matrix_user_id(identity)
                .map(str::to_owned)
                .map_err(|_| Failure::new(ErrorCode::Native, "Invalid native mention identities"))
        })
        .collect::<Result<Vec<_>>>()?;
    let edited = content.contains_key("m.new_content")
        || content
            .get("m.relates_to")
            .and_then(Value::as_object)
            .and_then(|relation| relation.get("rel_type"))
            .and_then(Value::as_str)
            == Some("m.replace");
    Ok(MatrixEvent {
        event_id: expected.to_owned(),
        room_id: room.to_owned(),
        sender_matrix_id: sender.to_owned(),
        event_type: event_type.to_owned(),
        message_type: content
            .get("msgtype")
            .and_then(Value::as_str)
            .map(str::to_owned),
        body: content
            .get("body")
            .and_then(Value::as_str)
            .map(str::to_owned),
        mentions,
        edited,
        control: listener_notice(event_type, content),
    })
}

pub fn mentions_agent(event: &MatrixEvent, receiver: &str) -> bool {
    event.event_type == "m.room.message"
        && event.sender_matrix_id != receiver
        && event.message_type.as_deref() == Some("m.text")
        && !event.edited
        && !event.control
        && event.mentions.iter().any(|identity| identity == receiver)
}
