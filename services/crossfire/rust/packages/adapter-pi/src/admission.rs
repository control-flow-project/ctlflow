use crate::{options::Options, protocol::Protocol};
use crossfire_domain::runtime::values::Setting;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

pub struct Selected {
    pub state: Value,
    pub settings: Vec<Setting>,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}

pub async fn admit(
    native: &impl Protocol,
    options: &Options,
    cancellation: CancellationToken,
) -> Result<Selected> {
    let available = native
        .request("get_available_models", &json!({}), cancellation.clone())
        .await?;
    let models = available
        .get("models")
        .and_then(Value::as_array)
        .filter(|values| values.len() <= 20_000 && values.iter().all(Value::is_object))
        .ok_or_else(|| invalid("Invalid native Pi model availability"))?;
    if let Some(model) = &options.model {
        if !models.iter().any(|value| {
            value.get("provider").and_then(Value::as_str) == options.provider.as_deref()
                && value.get("id").and_then(Value::as_str) == Some(model)
        }) {
            return Err(invalid(
                "Configured Pi provider/model is unavailable; no substitution was made",
            ));
        }
        let selected = native
            .request(
                "set_model",
                &json!({"provider":options.provider,"modelId":model}),
                cancellation.clone(),
            )
            .await?;
        if selected.get("provider").and_then(Value::as_str) != options.provider.as_deref()
            || selected.get("id").and_then(Value::as_str) != Some(model)
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Pi substituted the configured model",
            ));
        }
    }
    let thinking = native
        .request(
            "get_available_thinking_levels",
            &json!({}),
            cancellation.clone(),
        )
        .await?;
    let levels = thinking
        .get("levels")
        .and_then(Value::as_array)
        .filter(|values| values.iter().all(Value::is_string))
        .ok_or_else(|| invalid("Invalid native Pi thinking levels"))?;
    if let Some(level) = &options.thinking_level {
        if !levels.iter().any(|value| value.as_str() == Some(level)) {
            return Err(invalid(
                "Configured Pi thinking level is unavailable; no clamping or substitution was made",
            ));
        }
        native
            .request(
                "set_thinking_level",
                &json!({"level":level}),
                cancellation.clone(),
            )
            .await?;
    }
    let state = native
        .request("get_state", &json!({}), cancellation)
        .await?;
    let model = state
        .get("model")
        .filter(|value| value.is_object())
        .ok_or_else(|| invalid("Invalid effective Pi model"))?;
    let provider = model
        .get("provider")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Invalid effective Pi provider"))?;
    let name = model
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Invalid effective Pi model"))?;
    let level = state
        .get("thinkingLevel")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Invalid effective Pi thinking level"))?;
    if !models.iter().any(|value| {
        value.get("provider").and_then(Value::as_str) == Some(provider)
            && value.get("id").and_then(Value::as_str) == Some(name)
    }) || options
        .model
        .as_ref()
        .is_some_and(|model| model != name || options.provider.as_deref() != Some(provider))
        || options
            .thinking_level
            .as_ref()
            .is_some_and(|configured| configured != level)
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Pi effective settings differ from native admission",
        ));
    }
    let settings = vec![
        Setting {
            name: "provider".to_owned(),
            configured: options.provider.clone(),
            effective: Some(provider.to_owned()),
        },
        Setting {
            name: "model".to_owned(),
            configured: options.model.clone(),
            effective: Some(name.to_owned()),
        },
        Setting {
            name: "thinking_level".to_owned(),
            configured: options.thinking_level.clone(),
            effective: Some(level.to_owned()),
        },
        Setting {
            name: "native_version".to_owned(),
            configured: None,
            effective: Some(native.version().to_owned()),
        },
    ];
    Ok(Selected { state, settings })
}
