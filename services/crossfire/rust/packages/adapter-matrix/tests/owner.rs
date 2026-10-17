mod support;
use crossfire_kernel::failure::ErrorCode;
use crossfire_test_support::http::Fixture;
use serde_json::{Value, json};

fn private_state() -> Value {
    json!([
        {"type":"m.room.create","state_key":"","sender":"@owner:example.test","content":{"room_version":"12"}},
        {"type":"m.room.join_rules","state_key":"","sender":"@owner:example.test","content":{"join_rule":"invite"}},
        {"type":"m.room.history_visibility","state_key":"","sender":"@owner:example.test","content":{"history_visibility":"joined"}},
        {"type":"m.room.member","state_key":"@owner:example.test","sender":"@owner:example.test","content":{"membership":"join"}},
        {"type":"m.room.member","state_key":"@agent:example.test","sender":"@owner:example.test","content":{"membership":"join"}},
        {"type":"m.room.name","state_key":"","sender":"@owner:example.test","content":{"name":"Analyst"}}
    ])
}

#[tokio::test]
async fn selected_owner_conversation_is_revalidated_and_marked_direct_without_replacing_other_chats()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let (result, protocol) = tokio::join!(
        authority.owner_conversation(
            "@owner:example.test",
            "@agent:example.test",
            Some("!owner:example.test"),
            None
        ),
        async {
            support::login(&mut fixture, "@owner:example.test", "owner-token").await?;
            support::login(&mut fixture, "@agent:example.test", "agent-token").await?;
            fixture.next().await?.reply(200, &private_state())?;
            fixture.next().await?.reply(200, &private_state())?;
            support::cached(&mut fixture, "@owner:example.test", "owner-token").await?;
            let call = fixture.next().await?;
            assert_eq!(
                call.target,
                "/_matrix/client/v3/user/%40owner%3Aexample.test/account_data/m.direct"
            );
            call.reply(200, &json!({"@other:example.test":["!other:example.test"]}))?;
            let call = fixture.next().await?;
            assert_eq!(call.method, "PUT");
            assert_eq!(
                call.body,
                json!({"@other:example.test":["!other:example.test"],"@agent:example.test":["!owner:example.test"]})
            );
            call.reply(200, &json!({}))?;
            support::cached(&mut fixture, "@agent:example.test", "agent-token").await?;
            fixture
                .next()
                .await?
                .reply(404, &json!({"errcode":"M_NOT_FOUND"}))?;
            let call = fixture.next().await?;
            assert_eq!(call.method, "PUT");
            assert_eq!(
                call.body,
                json!({"@owner:example.test":["!owner:example.test"]})
            );
            call.reply(200, &json!({}))?;
            Ok::<_, Box<dyn std::error::Error>>(())
        }
    );
    protocol?;
    assert_eq!(result?, "!owner:example.test");
    Ok(())
}

#[tokio::test]
async fn private_owner_conversation_rejects_other_participants_and_never_marks_a_public_room_direct()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let (result, protocol) = tokio::join!(
        authority.owner_conversation(
            "@owner:example.test",
            "@agent:example.test",
            Some("!owner:example.test"),
            None
        ),
        async {
            support::login(&mut fixture, "@owner:example.test", "owner-token").await?;
            support::login(&mut fixture, "@agent:example.test", "agent-token").await?;
            let mut events = private_state();
            events.as_array_mut().ok_or("Missing fixture events")?.push(json!({"type":"m.room.member","state_key":"@outsider:example.test","sender":"@owner:example.test","content":{"membership":"invite"}}));
            fixture.next().await?.reply(200, &events)?;
            Ok::<_, Box<dyn std::error::Error>>(())
        }
    );
    protocol?;
    assert_eq!(
        result.err().map(|error| error.code),
        Some(ErrorCode::Forbidden)
    );
    let (result, protocol) = tokio::join!(
        authority.verify_owner_conversation(
            "@owner:example.test",
            "@agent:example.test",
            "!owner:example.test"
        ),
        async {
            support::cached(&mut fixture, "@owner:example.test", "owner-token").await?;
            let mut events = private_state();
            events[1]["content"]["join_rule"] = json!("public");
            fixture.next().await?.reply(200, &events)?;
            Ok::<_, Box<dyn std::error::Error>>(())
        }
    );
    protocol?;
    assert_eq!(
        result.err().map(|error| error.code),
        Some(ErrorCode::Forbidden)
    );
    Ok(())
}

#[tokio::test]
async fn notice_publication_uses_real_mention_metadata_and_does_not_turn_native_denial_into_success()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let (result, protocol) = tokio::join!(
        authority.send_notice(
            "@agent:example.test",
            "!room:example.test",
            "transaction-1",
            "Wake-up is blocked",
            "@sender:example.test"
        ),
        async {
            support::login(&mut fixture, "@agent:example.test", "agent-token").await?;
            let call = fixture.next().await?;
            assert_eq!(call.method, "PUT");
            assert_eq!(
                call.target,
                "/_matrix/client/v3/rooms/!room%3Aexample.test/send/m.room.message/transaction-1"
            );
            assert_eq!(
                call.body,
                json!({"msgtype":"m.notice","body":"Wake-up is blocked","m.mentions":{"user_ids":["@sender:example.test"]},"org.crossfire.listener_notice":true})
            );
            call.reply(403, &json!({"errcode":"M_FORBIDDEN"}))?;
            Ok::<_, Box<dyn std::error::Error>>(())
        }
    );
    protocol?;
    assert_eq!(
        result.err().map(|error| error.code),
        Some(ErrorCode::Forbidden)
    );
    let (result, protocol) = tokio::join!(
        authority.event("@agent:example.test", "!room:example.test", "$event"),
        async {
            support::cached(&mut fixture, "@agent:example.test", "agent-token").await?;
            fixture.next().await?.reply(200, &json!({"event_id":"$event","sender":"@sender:example.test","type":"m.room.message","content":{"msgtype":"m.text","body":"Quoted @agent text","m.mentions":{"user_ids":[]}}}))?;
            Ok::<_, Box<dyn std::error::Error>>(())
        }
    );
    protocol?;
    let event = result?;
    assert!(!crossfire_contracts::matrix_event::mentions_agent(
        &event,
        "@agent:example.test"
    ));
    Ok(())
}
