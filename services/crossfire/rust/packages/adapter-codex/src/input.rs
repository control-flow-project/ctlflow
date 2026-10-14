use crate::timeline::{Boundary, Capture};
use crossfire_adapter_runtime::journal::{self, NativeMessage};
use crossfire_contracts::validation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Published {
    #[serde(deserialize_with = "required_option")]
    pub turn: Option<String>,
    pub text: Arc<str>,
    pub message_id: String,
    #[serde(deserialize_with = "required_option")]
    pub boundary: Option<Boundary>,
    pub initializing: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    #[serde(flatten)]
    pub published: Published,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resumption: Option<Published>,
}

fn required_option<'de, T: Deserialize<'de>, D: serde::Deserializer<'de>>(
    value: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::<T>::deserialize(value)
}

impl Published {
    pub fn new(text: &str, message_id: &str, capture: Capture) -> Self {
        Self {
            turn: None,
            text: Arc::from(text),
            message_id: message_id.to_owned(),
            boundary: capture.boundary,
            initializing: capture.initializing,
        }
    }

    fn validate(&self) -> Result<()> {
        journal::validate_message(&self.text, &self.message_id)?;
        if let Some(turn) = &self.turn {
            validation::text(&serde_json::Value::String(turn.clone()), 1, 200)?;
        }
        if let Some(boundary) = &self.boundary
            && (!(0..=validation::SAFE_INTEGER).contains(&boundary.position)
                || boundary.key.is_empty()
                || validation::utf16_length(&boundary.key) > 1000)
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid native input verification boundary",
            ));
        }
        Ok(())
    }
}

impl NativeMessage for Input {
    fn text(&self) -> &str {
        &self.published.text
    }
    fn message_id(&self) -> &str {
        &self.published.message_id
    }
    fn validate(&self) -> Result<()> {
        self.published.validate()?;
        if let Some(resumption) = &self.resumption {
            resumption.validate()?;
            if !resumption.message_id.starts_with("crossfire-resume-")
                || resumption.message_id == self.message_id()
            {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Invalid native restart message identity",
                ));
            }
        }
        Ok(())
    }
}
