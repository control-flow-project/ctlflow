use crossfire_adapter_filesystem::absolute_state::AbsoluteState;
use crossfire_adapter_http::{JsonLimits, NativeHttp};
use crossfire_agent_core::local_state;
use crossfire_contracts::{origin::segment, validation as check};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use serde_json::Value;
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

pub async fn request(state: &Path, input: &Value, stop: CancellationToken) -> Result<Value> {
    let file = state.join("listener.json");
    let file = file
        .to_str()
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Listener state path is not Unicode"))?;
    let value: Value = local_state::read(&AbsoluteState, file, 65536)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "No active private listener endpoint"))?;
    let value = check::object(&value, &["port", "secret", "binding"], &[])?;
    let port = check::integer(&value["port"], 1, 65535)?;
    let secret = check::text(&value["secret"], 64, 64)?;
    if !secret
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid private listener credential",
        ));
    }
    let binding = check::text(&value["binding"], 1, 255)?;
    let response = NativeHttp::new(&format!("http://127.0.0.1:{port}"), stop)?
        .json(
            Some(&Secret::new(secret.to_owned())),
            reqwest::Method::POST,
            &format!("/bindings/{}/control", segment(binding)),
            Some(input),
            JsonLimits {
                request_bytes: 65536,
                response_bytes: 1048576,
                timeout: Duration::from_secs(40),
            },
        )
        .await?;
    if response.status != 200 {
        return Err(Failure::new(
            ErrorCode::Unavailable,
            "The exact private listener rejected this control request",
        ));
    }
    Ok(response.body)
}
