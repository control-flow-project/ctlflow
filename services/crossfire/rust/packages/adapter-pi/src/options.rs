use crossfire_contracts::validation;
use crossfire_domain::runtime::values::Setting;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Options {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thinking_level: Option<String>,
}

pub fn parse(value: &Value) -> Result<Options> {
    let input = validation::object(value, &[], &["provider", "model", "thinking_level"])?;
    let provider = input
        .get("provider")
        .map(|value| validation::text(value, 1, 200).map(str::to_owned))
        .transpose()?;
    let model = input
        .get("model")
        .map(|value| validation::text(value, 1, 200).map(str::to_owned))
        .transpose()?;
    let thinking_level = input
        .get("thinking_level")
        .map(|value| {
            validation::choice(
                value,
                &["off", "minimal", "low", "medium", "high", "xhigh", "max"],
            )
            .map(str::to_owned)
        })
        .transpose()?;
    if provider.is_some() != model.is_some() {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Pi provider and model must be configured together with exact native identities",
        ));
    }
    Ok(Options {
        provider,
        model,
        thinking_level,
    })
}
pub fn version(value: &str) -> Result<()> {
    if value.trim() == "1.0.0" {
        Ok(())
    } else {
        Err(Failure::new(
            ErrorCode::Invalid,
            "The Pi adapter requires verified @earendil-works/pi-coding-agent 1.0.0; other native protocols are not admitted",
        ))
    }
}
pub fn settings(options: &Options) -> Vec<Setting> {
    [
        ("provider", &options.provider),
        ("model", &options.model),
        ("thinking_level", &options.thinking_level),
    ]
    .into_iter()
    .filter_map(|(name, value)| {
        value.as_ref().map(|value| Setting {
            name: name.to_owned(),
            configured: Some(value.clone()),
            effective: None,
        })
    })
    .collect()
}
pub fn error_text(value: &str) -> String {
    let mut result = String::new();
    for character in value.chars() {
        let character = if matches!(character, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}')
        {
            ' '
        } else {
            character
        };
        if result.len() + character.len_utf8() > 4000 {
            break;
        }
        result.push(character);
    }
    result
}
