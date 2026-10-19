mod support;
use crossfire_domain::{
    messaging::{Membership, RoomAdmission},
    room_access::values::{Access, Intent},
};
use crossfire_kernel::failure::ErrorCode;
use crossfire_test_support::http::Fixture;
use serde_json::{Value, json};

fn state(target: &str, level: i64) -> Value {
    json!([
        {"type":"m.room.create","state_key":"","sender":"@owner:example.test","content":{"room_version":"12"}},
        {"type":"m.room.power_levels","state_key":"","sender":"@owner:example.test","content":{"users":{"@owner:example.test":100,"@agent:example.test":level},"events":{"m.room.message":0,"m.reaction":0,"m.room.power_levels":50},"invite":50}},
        {"type":"m.room.member","state_key":"@owner:example.test","sender":"@owner:example.test","content":{"membership":"join"}},
        {"type":"m.room.member","state_key":"@agent:example.test","sender":"@owner:example.test","content":{"membership":target,"displayname":"Analyst"}},
        {"type":"m.room.name","state_key":"","sender":"@owner:example.test","content":{"name":"x".repeat(254) + "🚀"}}
    ])
}

#[tokio::test]
async fn native_facts_preserve_creator_authority_and_whole_unicode_text()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let (result, protocol) = tokio::join!(
        authority.room("@owner:example.test", "!room:example.test", None),
        async {
            support::login(&mut fixture, "@owner:example.test", "owner-token").await?;
            let call = fixture.next().await?;
            assert_eq!(call.method, "GET");
            assert_eq!(
                call.target,
                "/_matrix/client/v3/rooms/!room%3Aexample.test/state"
            );
            call.reply(200, &state("join", 0))?;
            Ok::<_, Box<dyn std::error::Error>>(())
        }
    );
    protocol?;
    let facts = result?;
    assert_eq!(facts.access_fields[0].maximum, 9_007_199_254_740_991);
    assert!(facts.can_invite);
    assert_eq!(facts.name, "x".repeat(254));
    assert_eq!(
        facts.access_modes,
        vec![Access::Read, Access::Reply, Access::Custom]
    );
    assert!(
        facts
            .permissions
            .iter()
            .any(|value| value.action == "m.room.power_levels" && value.allowed)
    );
    assert_eq!(facts.authority_revision.len(), 64);
    let (result, protocol) = tokio::join!(
        authority.membership(
            "@owner:example.test",
            "@agent:example.test",
            "!room:example.test"
        ),
        async {
            support::cached(&mut fixture, "@owner:example.test", "owner-token").await?;
            fixture.next().await?.reply(200, &state("join", 0))?;
            Ok::<_, Box<dyn std::error::Error>>(())
        }
    );
    protocol?;
    let member = result?;
    assert_eq!(
        member
            .native_access
            .as_ref()
            .and_then(|value| value.get("powerLevel")),
        Some(&json!(0))
    );
    assert_eq!(member.display_name, "Analyst");
    Ok(())
}

#[tokio::test]
async fn native_read_access_is_written_joined_and_confirmed_before_success()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let access = Intent {
        access: Access::Read,
        native_access: None,
        muted: false,
    };
    let (result, protocol) = tokio::join!(
        authority.set_room_access(
            "@owner:example.test",
            "@agent:example.test",
            "!room:example.test",
            &access,
            Some(&RoomAdmission::Managed)
        ),
        async {
            support::login(&mut fixture, "@owner:example.test", "owner-token").await?;
            fixture.next().await?.reply(200, &state("leave", 0))?;
            support::cached(&mut fixture, "@owner:example.test", "owner-token").await?;
            let call = fixture.next().await?;
            assert_eq!(call.method, "GET");
            assert_eq!(
                call.target,
                "/_matrix/client/v3/rooms/!room%3Aexample.test/state/m.room.power_levels"
            );
            call.reply(
                200,
                &json!({"users":{"@owner:example.test":100},"events":{"m.room.message":0}}),
            )?;
            let call = fixture.next().await?;
            assert_eq!(call.method, "PUT");
            assert_eq!(
                call.body,
                json!({"users":{"@owner:example.test":100,"@agent:example.test":-1},"events":{"m.room.message":0}})
            );
            call.reply(200, &json!({}))?;
            support::cached(&mut fixture, "@owner:example.test", "owner-token").await?;
            let call = fixture.next().await?;
            assert_eq!(
                call.target,
                "/_matrix/client/v3/rooms/!room%3Aexample.test/invite"
            );
            assert_eq!(call.body, json!({"user_id":"@agent:example.test"}));
            call.reply(200, &json!({}))?;
            support::login(&mut fixture, "@agent:example.test", "agent-token").await?;
            let call = fixture.next().await?;
            assert_eq!(
                call.target,
                "/_matrix/client/v3/rooms/!room%3Aexample.test/join"
            );
            assert_eq!(
                call.headers.get("authorization").map(String::as_str),
                Some("Bearer agent-token")
            );
            call.reply(200, &json!({"room_id":"!room:example.test"}))?;
            support::cached(&mut fixture, "@owner:example.test", "owner-token").await?;
            fixture.next().await?.reply(200, &state("join", -1))?;
            Ok::<_, Box<dyn std::error::Error>>(())
        }
    );
    protocol?;
    let member = result?;
    assert_eq!(member.membership, Membership::Join);
    assert_eq!(
        member
            .native_access
            .as_ref()
            .and_then(|value| value.get("powerLevel")),
        Some(&json!(-1))
    );
    Ok(())
}

#[tokio::test]
async fn native_authority_rejects_nonmember_and_immutable_creator_restrictions()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let access = Intent {
        access: Access::Read,
        native_access: None,
        muted: false,
    };
    let (result, protocol) = tokio::join!(
        authority.set_room_access(
            "@owner:example.test",
            "@owner:example.test",
            "!room:example.test",
            &access,
            Some(&RoomAdmission::Managed)
        ),
        async {
            support::login(&mut fixture, "@owner:example.test", "owner-token").await?;
            fixture.next().await?.reply(200, &state("join", 0))?;
            Ok::<_, Box<dyn std::error::Error>>(())
        }
    );
    protocol?;
    assert_eq!(
        result.err().map(|error| error.code),
        Some(ErrorCode::Forbidden)
    );
    let (result, protocol) = tokio::join!(
        authority.room("@owner:example.test", "!room:example.test", None),
        async {
            support::cached(&mut fixture, "@owner:example.test", "owner-token").await?;
            let mut events = state("join", 0);
            events[2]["content"]["membership"] = json!("leave");
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
