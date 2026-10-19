use crate::syntax;
use crossfire_contracts::validation as check;
use crossfire_domain::messaging_client::{
    EventType, MessageAttachment, MessageContent, MessageEvent, MessageKind,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};

pub const NOTICE_MARKER: &str = "org.crossfire.listener_notice";
pub const IMPORTANT: &[&str] = &[
    "m.room.message",
    "m.room.member",
    "m.room.name",
    "m.room.topic",
    "m.room.power_levels",
    "m.room.join_rules",
    "m.room.history_visibility",
    "m.room.encryption",
    "m.room.encrypted",
    "m.room.redaction",
    "m.room.tombstone",
];

pub fn event_type(value: &str) -> EventType {
    match value {
        "m.room.message" => EventType::Message,
        "m.room.member" => EventType::Membership,
        "m.room.name" => EventType::Name,
        "m.room.topic" => EventType::Topic,
        "m.room.power_levels" => EventType::Access,
        "m.room.join_rules" => EventType::JoinPolicy,
        "m.room.history_visibility" => EventType::HistoryPolicy,
        "m.room.encryption" => EventType::Encryption,
        "m.room.encrypted" => EventType::Encrypted,
        "m.room.redaction" => EventType::Redaction,
        "m.room.tombstone" => EventType::Migration,
        _ => EventType::Other,
    }
}
pub fn native_types(selected: &[EventType]) -> Result<Vec<&'static str>> {
    if selected.contains(&EventType::Other) {
        return Err(invalid(
            "Matrix filtering cannot request an exhaustive unknown-event category",
        ));
    }
    Ok(IMPORTANT
        .iter()
        .copied()
        .filter(|value| selected.contains(&event_type(value)))
        .collect())
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub fn parse(value: &Value, room: &str) -> Result<MessageEvent> {
    syntax::room_id(&json!(room))?;
    let id = syntax::event_id(value.get("event_id").unwrap_or(&Value::Null))?;
    let sender = syntax::user_id(value.get("sender").unwrap_or(&Value::Null))?;
    let native_type = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Invalid Matrix event type"))?;
    if value
        .get("room_id")
        .is_some_and(|value| value.as_str() != Some(room))
    {
        return Err(invalid("Matrix event belongs to another room"));
    }
    let source = value
        .get("content")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("Invalid Matrix event content"))?;
    let mentions = source
        .get("m.mentions")
        .and_then(Value::as_object)
        .and_then(|value| value.get("user_ids"))
        .and_then(Value::as_array)
        .map_or(Ok(Vec::new()), |values| {
            values
                .iter()
                .map(|value| syntax::user_id(value).map(str::to_owned))
                .collect()
        })?;
    let edited = source.contains_key("m.new_content")
        || source
            .get("m.relates_to")
            .and_then(|value| value.get("rel_type"))
            .and_then(Value::as_str)
            == Some("m.replace");
    let kind = match source.get("msgtype").and_then(Value::as_str) {
        Some("m.text") => MessageKind::Text,
        Some("m.notice") => MessageKind::Notice,
        Some("m.image") => MessageKind::Image,
        Some("m.file") => MessageKind::File,
        Some("m.audio") => MessageKind::Audio,
        Some("m.video") => MessageKind::Video,
        Some("m.location") => MessageKind::Location,
        _ => MessageKind::Other,
    };
    let body = source
        .get("body")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let attachments = if let Some(url) = source.get("url").and_then(Value::as_str).filter(|_| {
        matches!(
            kind,
            MessageKind::Image | MessageKind::File | MessageKind::Audio | MessageKind::Video
        )
    }) {
        let info = source.get("info").and_then(Value::as_object);
        vec![MessageAttachment {
            id: url.to_owned(),
            name: body.clone(),
            media_type: info
                .and_then(|value| value.get("mimetype"))
                .and_then(Value::as_str)
                .map(str::to_owned),
            bytes: info
                .and_then(|value| value.get("size"))
                .and_then(|value| check::integer(value, 0, check::SAFE_INTEGER).ok()),
        }]
    } else {
        Vec::new()
    };
    let mut attributes = source.clone();
    for field in ["body", "msgtype", "m.mentions", NOTICE_MARKER] {
        attributes.remove(field);
    }
    if body.is_some() {
        attributes.remove("formatted_body");
    }
    Ok(MessageEvent {
        event_id: id,
        room_id: room.to_owned(),
        sender: sender.to_owned(),
        event_type: event_type(native_type),
        subject_id: value
            .get("state_key")
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| invalid("Invalid Matrix state identity"))
            })
            .transpose()?,
        sent_at: value
            .get("origin_server_ts")
            .map(|value| {
                check::integer(
                    value,
                    -crossfire_kernel::time::MAX_TIMESTAMP,
                    crossfire_kernel::time::MAX_TIMESTAMP,
                )
            })
            .transpose()?,
        omitted: (body.is_some() && source.contains_key("formatted_body"))
            .then(|| vec!["content.formatted_body".to_owned()]),
        content: MessageContent {
            kind,
            body,
            mentions,
            edited,
            control: native_type == "m.room.message"
                && kind == MessageKind::Notice
                && source.get(NOTICE_MARKER) == Some(&Value::Bool(true)),
            attachments,
            attributes: serde_json::Map::from_iter([
                ("eventType".to_owned(), json!(native_type)),
                ("content".to_owned(), Value::Object(attributes)),
            ]),
        },
    })
}
