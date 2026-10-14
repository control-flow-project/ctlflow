use crossfire_contracts::delivery_policy;
use serde_json::json;
#[test]
fn delivery_policy_requires_unique_native_sources_exact_room_intents_private_owner_readiness_and_bounded_instance_settings()
-> Result<(), Box<dyn std::error::Error>> {
    let value = json!({"agentId":crossfire_kernel::identity::id(),"matrixUserId":"@agent:example.test","ownerMatrixId":"@owner:example.test","status":"active","ownerStatus":"active","ownerConversation":"!private:example.test",
        "roomGrants":[{"roomId":"!private:example.test","accessMode":"reply","powerLevel":null,"muted":false}],"wakeMode":"selected","senderMatrixIds":["@owner:example.test"],"maxMessageBytes":65536,"fleetIdleTimeoutSeconds":1800});
    let parsed = delivery_policy::parse(&value)?;
    assert_eq!(parsed.max_message_bytes, 65536);
    assert_eq!(parsed.idle_timeout_seconds, 1800);
    let mut invalid = value.clone();
    invalid["senderMatrixIds"] = json!(["@agent:example.test"]);
    assert!(delivery_policy::parse(&invalid).is_err());
    invalid = value.clone();
    invalid["senderMatrixIds"] = json!(["@owner:example.test", "@owner:example.test"]);
    assert!(delivery_policy::parse(&invalid).is_err());
    invalid = value.clone();
    invalid["roomGrants"][0]["muted"] = json!(true);
    assert!(delivery_policy::parse(&invalid).is_err());
    invalid = value.clone();
    invalid["roomGrants"][0]["powerLevel"] = json!(10);
    assert!(delivery_policy::parse(&invalid).is_err());
    invalid = value.clone();
    invalid["ownerStatus"] = json!("suspended");
    assert!(delivery_policy::parse(&invalid).is_err());
    invalid = value.clone();
    invalid["maxMessageBytes"] = json!(4095);
    assert!(delivery_policy::parse(&invalid).is_err());
    invalid = value.clone();
    invalid["fleetIdleTimeoutSeconds"] = json!(604801);
    assert!(delivery_policy::parse(&invalid).is_err());
    invalid = value.clone();
    invalid["generation"] = json!(crossfire_kernel::identity::id());
    assert!(delivery_policy::parse(&invalid).is_err());
    Ok(())
}
