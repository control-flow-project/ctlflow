use crossfire_agent_core::events::{self, Event};
use crossfire_domain::messaging_client::{EventType, MessageContent, MessageEvent, MessageKind};
use serde_json::json;

fn message(milliseconds: Option<i64>) -> MessageEvent {
    MessageEvent {
        event_id: "event/exact".to_owned(),
        room_id: "room/main".to_owned(),
        sender: "person/human".to_owned(),
        event_type: EventType::Message,
        subject_id: None,
        sent_at: milliseconds,
        omitted: None,
        content: MessageContent {
            kind: MessageKind::Text,
            body: Some("plain".to_owned()),
            mentions: vec!["agent/name".to_owned()],
            edited: false,
            control: false,
            attachments: vec![],
            attributes: Default::default(),
        },
    }
}
#[test]
fn events_preserve_attribution_calendar_and_state_without_backend_dependencies()
-> Result<(), Box<dyn std::error::Error>> {
    for (milliseconds, expected) in [
        (-8640000000000000i64, "-271821-04-20T00:00:00.000Z"),
        (-1, "1969-12-31T23:59:59.999Z"),
        (8640000000000000, "+275760-09-13T00:00:00.000Z"),
    ] {
        let value = events::view(&message(Some(milliseconds)), "room/main")?;
        assert_eq!(value.timestamp.as_deref(), Some(expected));
        assert_eq!(value.content.mentions[0], "agent/name");
        let encoded = serde_json::to_value(&value)?;
        let decoded: Event = serde_json::from_value(encoded.clone())?;
        decoded.validate()?;
        assert_eq!(value, decoded);
        for field in [
            "roomId",
            "origin",
            "eventId",
            "sender",
            "type",
            "content",
            "timestamp",
            "subjectId",
        ] {
            let mut damaged = encoded.clone();
            damaged
                .as_object_mut()
                .ok_or("event must be object")?
                .remove(field);
            assert!(
                serde_json::from_value::<Event>(damaged).is_err(),
                "required event field {field}"
            );
        }
        for timestamp in [
            "2026-02-29T00:00:00.000Z",
            "2024-02-30T00:00:00.000Z",
            "+000026-01-01T00:00:00.000Z",
            "+275760-09-14T00:00:00.000Z",
            "0000-00-01T00:00:00.000Z",
        ] {
            let mut damaged = value.clone();
            damaged.timestamp = Some(timestamp.to_owned());
            assert!(damaged.validate().is_err());
        }
        let mut damaged = encoded;
        damaged
            .as_object_mut()
            .ok_or("event must be object")?
            .insert("unrecognized".to_owned(), json!(true));
        assert!(serde_json::from_value::<Event>(damaged).is_err());
    }
    let mut value = message(None);
    value.content.kind = MessageKind::Notice;
    value.content.control = true;
    assert!(events::notice(&value));
    value.content.control = false;
    assert!(!events::notice(&value));
    Ok(())
}
#[test]
fn acquisition_moves_large_content_without_copying_its_allocation()
-> Result<(), Box<dyn std::error::Error>> {
    let mut value = message(None);
    value.content.body = Some("content".repeat(100000));
    let allocation = value.content.body.as_ref().ok_or("body required")?.as_ptr() as usize;
    let event = events::take(value, "room/main")?;
    assert_eq!(
        event.content.body.as_ref().ok_or("body required")?.as_ptr() as usize,
        allocation
    );
    Ok(())
}
