mod support;
use crossfire_domain::{messaging::MessagingAuthority, port::BackendUserIdentity};
use crossfire_kernel::{failure::ErrorCode, secret::Secret};
use crossfire_test_support::http::Fixture;
use serde_json::{Value, json};

#[tokio::test]
async fn shutdown_cancels_pending_control_login_and_cannot_repopulate_its_cache()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let (result, protocol) = tokio::join!(authority.as_user("@owner:example.test"), async {
        let call = fixture.next().await?;
        authority.close();
        call.reply(200, &support::account("@owner:example.test", "late-token"))
    });
    protocol?;
    assert!(result.is_err());
    assert!(authority.as_user("@owner:example.test").await.is_err());
    authority.close();
    Ok(())
}

#[tokio::test]
async fn signed_control_login_verifies_cached_identity_and_refreshes_only_expired_credentials()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let (result, protocol) = tokio::join!(
        authority.as_user("@owner:example.test"),
        support::login(&mut fixture, "@owner:example.test", "token-1")
    );
    protocol?;
    assert_eq!(result?.expose(), "token-1");
    let (result, protocol) = tokio::join!(
        authority.as_user("@owner:example.test"),
        support::cached(&mut fixture, "@owner:example.test", "token-1")
    );
    protocol?;
    assert_eq!(result?.expose(), "token-1");
    let (result, protocol) = tokio::join!(authority.as_user("@owner:example.test"), async {
        let call = fixture.next().await?;
        assert_eq!(call.target, "/_matrix/client/v3/account/whoami");
        call.reply(401, &json!({"errcode":"M_UNKNOWN_TOKEN"}))?;
        support::login(&mut fixture, "@owner:example.test", "token-2").await
    });
    protocol?;
    assert_eq!(result?.expose(), "token-2");
    let (result, protocol) = tokio::join!(authority.as_user("@owner:example.test"), async {
        let call = fixture.next().await?;
        call.reply(200, &json!({"user_id":"@other:example.test"}))
    });
    protocol?;
    assert_eq!(
        result.err().map(|error| error.code),
        Some(ErrorCode::Native)
    );
    authority.close();
    assert!(authority.as_user("@owner:example.test").await.is_err());
    Ok(())
}

#[tokio::test]
async fn protocol_provisioning_completes_supported_challenges_without_changing_password_or_identity()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let native = serde_json::Map::from_iter([("deviceId".to_owned(), json!("DEVICE"))]);
    let password = Secret::new("native-password".to_owned());
    let (result, protocol) = tokio::join!(
        MessagingAuthority::provision(&authority, "@agent:example.test", &password, &native),
        async {
            let call = fixture.next().await?;
            assert_eq!(call.method, "POST");
            assert_eq!(call.target, "/_matrix/client/v3/register");
            assert_eq!(
                call.body,
                json!({"username":"agent","password":"native-password","device_id":"DEVICE","inhibit_login":false})
            );
            call.reply(401, &json!({"session":"challenge-1","flows":[{"stages":["m.login.dummy","m.login.registration_token"]}]}))?;
            let call = fixture.next().await?;
            assert_eq!(
                call.body.get("auth"),
                Some(&json!({"type":"m.login.dummy","session":"challenge-1"}))
            );
            call.reply(401, &json!({"session":"challenge-1","completed":["m.login.dummy"],"flows":[{"stages":["m.login.dummy","m.login.registration_token"]}]}))?;
            let call = fixture.next().await?;
            assert_eq!(
                call.body.get("auth"),
                Some(
                    &json!({"type":"m.login.registration_token","session":"challenge-1","token":"registration-key"})
                )
            );
            assert_eq!(
                call.body.get("password").and_then(Value::as_str),
                Some("native-password")
            );
            call.reply(200, &support::account("@agent:example.test", "new-token"))
        }
    );
    protocol?;
    let account = result?;
    assert_eq!(account.user_id, "@agent:example.test");
    assert_eq!(account.access_token.expose(), "new-token");
    assert!(!format!("{account:?}").contains("new-token"));
    Ok(())
}

#[tokio::test]
async fn existing_accounts_use_the_exact_configured_credentials()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let native = serde_json::Map::from_iter([("deviceId".to_owned(), json!("DEVICE"))]);
    let password = Secret::new("saved-password".to_owned());
    let (result, protocol) = tokio::join!(
        authority.provision("@agent:example.test", &password, &native),
        async {
            fixture
                .next()
                .await?
                .reply(400, &json!({"errcode":"M_USER_IN_USE"}))?;
            let call = fixture.next().await?;
            assert_eq!(call.target, "/_matrix/client/v3/login");
            assert_eq!(
                call.body,
                json!({"type":"m.login.password","identifier":{"type":"m.id.user","user":"@agent:example.test"},"password":"saved-password","device_id":"DEVICE"})
            );
            call.reply(200, &json!({"user_id":"@agent:example.test","access_token":"saved-token","device_id":"d".repeat(255)}))
        }
    );
    protocol?;
    assert_eq!(
        result?.native["deviceId"]
            .as_str()
            .ok_or("device ID")?
            .len(),
        255
    );
    Ok(())
}

#[tokio::test]
async fn identity_profile_and_deactivation_fail_closed_at_native_boundaries()
-> Result<(), Box<dyn std::error::Error>> {
    let mut fixture = Fixture::open().await?;
    let authority = support::authority(&fixture)?;
    let token = Secret::new("human-token".to_owned());
    let (result, protocol) = tokio::join!(authority.identify(&token), async {
        let call = fixture.next().await?;
        assert_eq!(call.target, "/_matrix/client/v3/account/whoami");
        call.reply(200, &json!({"user_id":"@human:other.test"}))
    });
    protocol?;
    assert_eq!(
        result.err().map(|error| error.code),
        Some(ErrorCode::Unauthorized)
    );
    let (result, protocol) = tokio::join!(authority.profile_name("@agent:example.test"), async {
        fixture
            .next()
            .await?
            .reply(200, &json!({"displayname":null}))
    });
    protocol?;
    assert_eq!(result?, None);
    for protected in [
        "@service:example.test",
        "@conduit:example.test",
        "@agent:other.test",
    ] {
        assert_eq!(
            authority
                .deactivate(protected)
                .await
                .err()
                .map(|error| error.code),
            Some(ErrorCode::Forbidden)
        );
    }
    let (result, protocol) = tokio::join!(authority.deactivate("@agent:example.test"), async {
        let call = fixture.next().await?;
        assert_eq!(
            call.body.get("password").and_then(Value::as_str),
            Some("crossfire-deactivation-probe")
        );
        call.reply(403, &json!({"errcode":"M_USER_DEACTIVATED"}))
    });
    protocol?;
    result?;
    Ok(())
}
