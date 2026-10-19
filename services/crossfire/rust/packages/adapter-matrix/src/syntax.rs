use crossfire_contracts::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;

pub fn user_id(value: &Value) -> Result<&str> {
    value
        .as_str()
        .filter(|value| {
            validation::utf16_length(value) <= 255
                && value.starts_with('@')
                && !value.chars().any(validation::whitespace)
                && value[1..]
                    .split_once(':')
                    .is_some_and(|(local, host)| !local.is_empty() && !host.is_empty())
        })
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Expected a Matrix user ID"))
}
fn native_id(value: &Value, prefix: char, message: &str) -> Result<String> {
    value
        .as_str()
        .filter(|value| {
            validation::utf16_length(value) <= 255
                && value.starts_with(prefix)
                && value.len() > 1
                && !value.chars().any(validation::whitespace)
        })
        .map(str::to_owned)
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, message))
}
pub fn room_id(value: &Value) -> Result<String> {
    native_id(value, '!', "Expected an immutable Matrix room ID")
}
pub fn event_id(value: &Value) -> Result<String> {
    native_id(value, '$', "Expected a Matrix event ID")
}
