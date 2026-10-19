use crossfire_contracts::validation as check;
use crossfire_domain::messaging_client::{
    EventType, MessageContent, MessageEvent, MessageKind, OriginKind, RoomOrigin,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::iso_timestamp};
use serde::{Deserialize, Serialize};
use serde_json::json;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentFile {
    pub file: String,
    pub bytes: usize,
    pub sha256: String,
    pub source_bytes: usize,
    pub attachment_bytes: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub room_id: String,
    pub origin: RoomOrigin,
    pub event_id: String,
    pub sender: String,
    #[serde(rename = "type")]
    pub kind: EventType,
    pub content: MessageContent,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub timestamp: Option<String>,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub subject_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omitted: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_file: Option<ContentFile>,
}
pub fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub fn notice(value: &MessageEvent) -> bool {
    value.event_type == EventType::Message && notice_content(&value.content)
}
pub fn notice_content(value: &MessageContent) -> bool {
    value.kind == MessageKind::Notice && value.control
}
pub fn view(value: &MessageEvent, room: &str) -> Result<Event> {
    take(value.clone(), room)
}
pub fn take(value: MessageEvent, room: &str) -> Result<Event> {
    if value.room_id != room {
        return Err(invalid("Message belongs to another room"));
    }
    let result = Event {
        room_id: room.to_owned(),
        origin: RoomOrigin {
            kind: OriginKind::Unknown,
            name: None,
            alias: None,
        },
        event_id: value.event_id,
        sender: value.sender,
        kind: value.event_type,
        content: value.content,
        timestamp: value.sent_at.map(iso_timestamp).transpose()?,
        subject_id: value.subject_id,
        omitted: value.omitted,
        content_file: None,
    };
    result.validate()?;
    Ok(result)
}
pub fn validate_content(content: &MessageContent) -> Result<()> {
    if content.mentions.len() > 2000 || content.attachments.len() > 1000 {
        return Err(invalid("Excessive message metadata"));
    }
    for identity in &content.mentions {
        check::backend_user_id(&json!(identity))?;
    }
    for file in &content.attachments {
        check::text(&json!(file.id), 1, 4096)?;
        if let Some(name) = &file.name {
            check::text(&json!(name), 0, 4096)?;
        }
        if let Some(media_type) = &file.media_type {
            check::text(&json!(media_type), 1, 255)?;
        }
        if let Some(bytes) = file.bytes {
            check::integer(&json!(bytes), 0, check::SAFE_INTEGER)?;
        }
    }
    Ok(())
}
impl Event {
    pub fn validate(&self) -> Result<()> {
        check::room_id(&json!(self.room_id))?;
        check::event_id(&json!(self.event_id))?;
        check::backend_user_id(&json!(self.sender))?;
        validate_content(&self.content)?;
        if let Some(subject) = &self.subject_id {
            check::text(&json!(subject), 0, 255)?;
        }
        if let Some(name) = &self.origin.name {
            check::plain_text(&json!(name), 16000)?;
        }
        if let Some(alias) = &self.origin.alias {
            check::text(&json!(alias), 1, 255)?;
        }
        if let Some(timestamp) = &self.timestamp {
            validate_timestamp(timestamp)?;
        }
        if let Some(omitted) = &self.omitted {
            if omitted.len() > 100 {
                return Err(invalid("Excessive omitted fields"));
            }
            for field in omitted {
                check::text(&json!(field), 1, 255)?;
            }
        }
        if let Some(file) = &self.content_file {
            check::text(&json!(file.file), 1, 4096)?;
            if file.bytes == 0
                || file.sha256.len() != 64
                || !file.sha256.bytes().all(|character| {
                    character.is_ascii_digit() || (b'a'..=b'f').contains(&character)
                })
                || file.attachment_bytes < 0
            {
                return Err(invalid("Invalid retained event artifact"));
            }
        }
        Ok(())
    }
}
fn validate_timestamp(timestamp: &str) -> Result<()> {
    let extended = timestamp.starts_with(['+', '-']);
    let year_end = if extended { 7 } else { 4 };
    let bytes = timestamp.as_bytes();
    if bytes.len() != year_end + 20 || !timestamp.is_ascii() {
        return Err(invalid("Invalid retained timestamp"));
    }
    let year = timestamp[..year_end]
        .parse::<i64>()
        .map_err(|_| invalid("Invalid timestamp year"))?;
    if extended && (0..=9999).contains(&year) || !(-271821..=275760).contains(&year) {
        return Err(invalid("Invalid timestamp year range"));
    }
    let rest = &timestamp[year_end..];
    if ![
        (0, b'-'),
        (3, b'-'),
        (6, b'T'),
        (9, b':'),
        (12, b':'),
        (15, b'.'),
        (19, b'Z'),
    ]
    .iter()
    .all(|(index, expected)| rest.as_bytes()[*index] == *expected)
        || rest.bytes().enumerate().any(|(index, value)| {
            ![0, 3, 6, 9, 12, 15, 19].contains(&index) && !value.is_ascii_digit()
        })
    {
        return Err(invalid("Invalid timestamp shape"));
    }
    let number = |start: usize, end: usize| {
        rest[start..end]
            .parse::<u32>()
            .map_err(|_| invalid("Invalid timestamp fields"))
    };
    let month = number(1, 3)?;
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        4 | 6 | 9 | 11 => 30,
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        _ => 0,
    };
    if days == 0
        || !(1..=days).contains(&number(4, 6)?)
        || number(7, 9)? > 23
        || number(10, 12)? > 59
        || number(13, 15)? > 59
        || year == -271821 && rest < "-04-20T00:00:00.000Z"
        || year == 275760 && rest > "-09-13T00:00:00.000Z"
    {
        return Err(invalid("Invalid timestamp calendar fields"));
    }
    Ok(())
}
