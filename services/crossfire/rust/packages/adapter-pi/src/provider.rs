use crossfire_agent_core::owned_runtime::ProviderState;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;

pub fn parse(state: &Value, available: &Value) -> Result<ProviderState> {
    let invalid = || Failure::new(ErrorCode::Native, "Native provider metadata is invalid");
    let model = state.get("model").ok_or_else(invalid)?;
    let provider = model
        .get("provider")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let id = model
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let models = available
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    if models.len() > 20000 {
        return Err(invalid());
    }
    let mut present = false;
    for model in models {
        let candidate_provider = model
            .get("provider")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let candidate_id = model
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        present |= candidate_provider == provider && candidate_id == id;
    }
    Ok(if present {
        ProviderState::Present
    } else {
        ProviderState::Missing
    })
}
