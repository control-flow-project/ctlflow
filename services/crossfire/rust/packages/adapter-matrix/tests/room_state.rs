use crossfire_adapter_matrix::room_state::{creators, owner_conversation, powers, state};
use serde_json::json;

#[test]
fn native_room_creators_and_private_context_are_not_guessed()
-> Result<(), Box<dyn std::error::Error>> {
    let events = state(&json!([
        {"type":"m.room.create","state_key":"","sender":"@owner:server.test","content":{"room_version":"12","additional_creators":["@agent:server.test"]}},
        {"type":"m.room.join_rules","state_key":"","sender":"@owner:server.test","content":{"join_rule":"invite"}},
        {"type":"m.room.member","state_key":"@owner:server.test","sender":"@owner:server.test","content":{"membership":"join"}}
    ]))?;
    assert_eq!(
        creators(&events)?,
        ["@owner:server.test", "@agent:server.test"]
    );
    owner_conversation(&events, "@owner:server.test", "@agent:server.test")?;
    assert!(owner_conversation(&events, "@stranger:server.test", "@agent:server.test").is_err());
    let mut encrypted = events.clone();
    encrypted.extend(state(&json!([{"type":"m.room.encryption","state_key":"","sender":"@owner:server.test","content":{}}]))?);
    assert!(owner_conversation(&encrypted, "@owner:server.test", "@agent:server.test").is_err());
    let mut public = events.clone();
    public.extend(state(&json!([{"type":"m.room.member","state_key":"@stranger:server.test","sender":"@owner:server.test","content":{"membership":"invite"}}]))?);
    assert!(owner_conversation(&public, "@owner:server.test", "@agent:server.test").is_err());
    Ok(())
}

#[test]
fn native_power_levels_reject_invalid_or_unrepresentable_thresholds()
-> Result<(), Box<dyn std::error::Error>> {
    let content = json!({"users":{"@owner:server.test":100},"events":{"m.room.message":0,"m.reaction":1,"m.room.power_levels":50}});
    let levels = powers(
        content.as_object().ok_or("Missing fixture object")?,
        "@owner:server.test",
    )?;
    assert_eq!(levels.owner_level, 100);
    assert_eq!(levels.ceiling, -1);
    assert_eq!(levels.reaction, 1);
    let invalid = json!({"users":{},"events":{"m.room.message":"0"}});
    assert!(
        powers(
            invalid.as_object().ok_or("Missing fixture object")?,
            "@owner:server.test"
        )
        .is_err()
    );
    let invalid = json!({"invite":-9007199254740991_i64});
    assert!(
        powers(
            invalid.as_object().ok_or("Missing fixture object")?,
            "@owner:server.test"
        )
        .is_err()
    );
    Ok(())
}
