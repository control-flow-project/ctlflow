use crate::{account::Configuration, syntax};
use crossfire_contracts::{origin, validation as check};
use crossfire_domain::messaging::BackendConfiguration;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use serde_json::{Value, json};

pub const READINESS_PATH: &str = "/_matrix/client/versions";
pub fn administrator_user(username: &str, server_name: &str) -> Result<String> {
    if username.is_empty()
        || username.len() > 80
        || !username.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"._=-".contains(&byte)
        })
        || username == "conduit"
        || username.starts_with("crossfire-")
        || username.starts_with("agent-")
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Supply a regular human --administrator username",
        ));
    }
    let administrator = format!("@{username}:{server_name}");
    syntax::user_id(&json!(administrator))?;
    Ok(administrator)
}
pub fn read(
    configuration: &BackendConfiguration,
    instance: &str,
    administrator: &str,
) -> Result<Configuration> {
    let fields = check::object(
        &Value::Object(configuration.parameters.clone()),
        &["serverName", "origin", "jwtSecret", "registrationSecret"],
        &[],
    )?
    .clone();
    if configuration.backend_type != "matrix" {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Unsupported messaging backend",
        ));
    }
    let server_name = check::text(&fields["serverName"], 1, 200)?;
    let (host, port) = server_name
        .split_once(':')
        .map_or((server_name, None), |(host, port)| (host, Some(port)));
    if host.is_empty()
        || !host.bytes().all(|value| {
            value.is_ascii_lowercase() || value.is_ascii_digit() || matches!(value, b'.' | b'-')
        })
        || port.is_some_and(|port| {
            port.is_empty() || !port.bytes().all(|value| value.is_ascii_digit())
        })
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid Matrix server name",
        ));
    }
    syntax::user_id(&json!(administrator))?;
    if !administrator.ends_with(&format!(":{server_name}")) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Administrator must belong to the configured Matrix server",
        ));
    }
    Ok(Configuration {
        origin: origin::parse(check::text(&fields["origin"], 1, 2048)?)?.to_string(),
        server_name: server_name.to_owned(),
        jwt_secret: Secret::new(check::text(&fields["jwtSecret"], 32, 200)?.to_owned()),
        registration_secret: Secret::new(
            check::text(&fields["registrationSecret"], 32, 200)?.to_owned(),
        ),
        service_backend_user_id: format!("@crossfire-{instance}:{server_name}"),
    })
}
