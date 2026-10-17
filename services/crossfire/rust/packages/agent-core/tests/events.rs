use crossfire_agent_core::events::{self, Event};
use serde_json::json;

#[test]
fn native_events_preserve_attribution_calendar_and_state_without_formatted_duplicates()
-> Result<(), Box<dyn std::error::Error>> {
    for (milliseconds, expected) in [
        (-8640000000000000i64, "-271821-04-20T00:00:00.000Z"),
        (-1, "1969-12-31T23:59:59.999Z"),
        (8640000000000000, "+275760-09-13T00:00:00.000Z"),
    ] {
        let native = json!({"event_id":"$exact","sender":"@human:local","type":"m.room.message","content":{"body":"plain","formatted_body":"<p>plain</p>","m.mentions":{"user_ids":["@agent:local"]}},"origin_server_ts":milliseconds});
        let value = events::view(&native, "!room:local")?;
        assert_eq!(value.timestamp.as_deref(), Some(expected));
        assert!(value.content.get("formatted_body").is_none());
        assert_eq!(value.content["m.mentions"]["user_ids"][0], "@agent:local");
        let encoded = serde_json::to_value(&value)?;
        let decoded: Event = serde_json::from_value(encoded.clone())?;
        decoded.validate()?;
        assert_eq!(value, decoded);
        for field in [
            "room_id",
            "origin",
            "event_id",
            "sender",
            "type",
            "content",
            "timestamp",
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
    }
    assert!(events::notice(
        &json!({"type":"m.room.message","content":{"msgtype":"m.notice","org.crossfire.listener_notice":true}})
    ));
    assert!(!events::notice(
        &json!({"type":"m.room.message","content":{"msgtype":"m.text","body":"org.crossfire.listener_notice"}})
    ));
    Ok(())
}

#[test]
fn acquisition_moves_large_content_without_copying_the_native_string_allocation()
-> Result<(), Box<dyn std::error::Error>> {
    let native = json!({"event_id":"$large","sender":"@human:local","type":"m.room.message","content":{"body":"content".repeat(100000),"msgtype":"m.text"}});
    let allocation = native["content"]["body"]
        .as_str()
        .ok_or("body required")?
        .as_ptr() as usize;
    let event = events::take(native, "!room:local")?;
    assert_eq!(
        event.content["body"]
            .as_str()
            .ok_or("body required")?
            .as_ptr() as usize,
        allocation
    );
    Ok(())
}
