use crossfire_agent_core::owned_runtime::ProviderState;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;

pub fn parse(value: &Value) -> Result<ProviderState> {
    let required = value.get("requiresOpenaiAuth").and_then(Value::as_bool);
    let account = value.get("account");
    match (required, account) {
        (Some(_), Some(account)) if account.is_object() => Ok(ProviderState::Present),
        (Some(true), Some(Value::Null)) => Ok(ProviderState::Missing),
        (Some(false), Some(Value::Null)) => Ok(ProviderState::NotRequired),
        _ => Err(Failure::new(
            ErrorCode::Native,
            "Native provider metadata is invalid",
        )),
    }
}
