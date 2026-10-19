mod support;
use crossfire_test_support::http::Fixture;
use serde_json::json;

#[tokio::test]
async fn invitations_use_incremental_sync_and_verify_current_author_and_native_event()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let (result, protocol) = tokio::join!(
        authority.invitation("@agent:example.test", "!room:example.test"),
        async {
            support::login(&mut fixture, "@agent:example.test", "agent-token").await?;
            let call = fixture.next().await?;
            assert!(
                call.target
                    .starts_with("/_matrix/client/v3/sync?timeout=0&filter=")
            );
            assert!(!call.target.contains("&since="));
            call.reply(200, &json!({"next_batch":"cursor-1","rooms":{"invite":{"!room:example.test":{"invite_state":{"events":[{"type":"m.room.member","state_key":"@agent:example.test","sender":"@owner:example.test","content":{"membership":"invite"}}]}}}}}))?;
            let call = fixture.next().await?;
            assert!(call.target.ends_with("&since=cursor-1"));
            call.reply(200, &json!({"next_batch":"cursor-2","rooms":{}}))?;
            support::login(&mut fixture, "@owner:example.test", "owner-token").await?;
            let call = fixture.next().await?;
            assert_eq!(
                call.target,
                "/_matrix/client/v3/rooms/!room%3Aexample.test/state"
            );
            call.reply(200, &json!([{"type":"m.room.member","state_key":"@agent:example.test","sender":"@owner:example.test","event_id":"$invitation","content":{"membership":"invite","is_direct":true}}]))?;
            Ok::<_, Box<dyn std::error::Error>>(())
        }
    );
    protocol?;
    let invitation = result?.ok_or("Missing verified invitation")?;
    assert_eq!(invitation.event_id, "$invitation");
    assert_eq!(invitation.sender_backend_user_id, "@owner:example.test");
    assert!(invitation.direct);
    let (result, protocol) = tokio::join!(
        authority.invitation("@agent:example.test", "!room:example.test"),
        async {
            support::cached(&mut fixture, "@agent:example.test", "agent-token").await?;
            let call = fixture.next().await?;
            assert!(call.target.ends_with("&since=cursor-2"));
            call.reply(
                200,
                &json!({"next_batch":"cursor-3","rooms":{"leave":{"!room:example.test":{}}}}),
            )?;
            Ok::<_, Box<dyn std::error::Error>>(())
        }
    );
    protocol?;
    assert_eq!(result?, None);
    Ok(())
}
