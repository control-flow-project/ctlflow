use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use crossfire_adapter_matrix::account::{Authority, Configuration};
use crossfire_kernel::{Result, identity, secret::Secret};
use crossfire_test_support::http::Fixture;
use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::Sha256;

pub fn authority(fixture: &Fixture) -> Result<Authority> {
    Authority::new(Configuration {
        origin: fixture.origin.clone(),
        server_name: "example.test".to_owned(),
        jwt_secret: Secret::new("control-key".to_owned()),
        registration_secret: Secret::new("registration-key".to_owned()),
        service_matrix_id: "@service:example.test".to_owned(),
    })
}

pub fn account(user: &str, token: &str) -> Value {
    json!({"user_id":user,"access_token":token,"device_id":"CROSSFIRE_TEST"})
}

pub async fn login(
    fixture: &mut Fixture,
    user: &str,
    token: &str,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let call = fixture.next().await?;
    assert_eq!(call.method, "POST");
    assert_eq!(call.target, "/_matrix/client/v3/login");
    assert_eq!(
        call.body.get("type").and_then(Value::as_str),
        Some("m.login.token")
    );
    assert_eq!(
        call.body.get("device_id").and_then(Value::as_str),
        Some("CROSSFIRE_MANAGEMENT")
    );
    let encoded = call
        .body
        .get("token")
        .and_then(Value::as_str)
        .ok_or("Missing control JWT")?;
    let parts: Vec<_> = encoded.split('.').collect();
    assert_eq!(parts.len(), 3);
    let header: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[0])?)?;
    let payload: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(parts[1])?)?;
    assert_eq!(header, json!({"alg":"HS256","typ":"JWT"}));
    assert_eq!(payload.get("sub").and_then(Value::as_str), Some(user));
    let expires = payload
        .get("exp")
        .and_then(Value::as_i64)
        .ok_or("Missing JWT expiry")?;
    let now = identity::now()? / 1000;
    assert!((now + 50..=now + 60).contains(&expires));
    let mut mac = Hmac::<Sha256>::new_from_slice(b"control-key")?;
    mac.update(format!("{}.{}", parts[0], parts[1]).as_bytes());
    mac.verify_slice(&URL_SAFE_NO_PAD.decode(parts[2])?)?;
    call.reply(200, &account(user, token))?;
    Ok(())
}

pub async fn cached(
    fixture: &mut Fixture,
    user: &str,
    token: &str,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let call = fixture.next().await?;
    assert_eq!(call.method, "GET");
    assert_eq!(call.target, "/_matrix/client/v3/account/whoami");
    assert_eq!(
        call.headers.get("authorization").map(String::as_str),
        Some(format!("Bearer {token}").as_str())
    );
    call.reply(200, &json!({"user_id":user}))?;
    Ok(())
}
