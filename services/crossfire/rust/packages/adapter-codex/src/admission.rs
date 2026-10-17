use crate::{
    options::Options,
    protocol::{Protocol, Reply},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Selection {
    pub model: String,
    pub effort: String,
}

pub struct Model {
    pub model: String,
    pub is_default: bool,
    pub default_effort: String,
    pub efforts: BTreeSet<String>,
}

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Native, message)
}

fn object(value: &Value) -> Result<&Map<String, Value>> {
    value
        .as_object()
        .ok_or_else(|| invalid("Invalid native model capabilities"))
}

fn text<'a>(value: &'a Map<String, Value>, name: &str) -> Result<&'a str> {
    value
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid("Invalid native model capabilities"))
}

pub fn model(value: &Value) -> Result<Model> {
    let value = object(value)?;
    let name = text(value, "model")?;
    let is_default = value
        .get("isDefault")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("Invalid native model capabilities"))?;
    let default_effort = text(value, "defaultReasoningEffort")?;
    let efforts = value
        .get("supportedReasoningEfforts")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Invalid native reasoning capabilities"))?;
    let mut selected = BTreeSet::new();
    for effort in efforts {
        let effort = text(object(effort)?, "reasoningEffort")?;
        if !selected.insert(effort.to_owned()) {
            return Err(invalid(
                "Ambiguous native model catalog or unsupported native default effort",
            ));
        }
    }
    if !selected.contains(default_effort) {
        return Err(invalid(
            "Ambiguous native model catalog or unsupported native default effort",
        ));
    }
    Ok(Model {
        model: name.to_owned(),
        is_default,
        default_effort: default_effort.to_owned(),
        efforts: selected,
    })
}

fn supplied(value: &Map<String, Value>, name: &str) -> Result<Option<String>> {
    match value.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        _ => Err(invalid(
            "Codex did not expose its effective native configuration",
        )),
    }
}

pub fn select(
    configured: &Options,
    effective: &Map<String, Value>,
    models: &BTreeMap<String, Model>,
) -> Result<Selection> {
    let name = match &configured.model {
        Some(value) => Some(value.clone()),
        None => supplied(effective, "model")?,
    };
    let selected = match &name {
        Some(name) => models.get(name),
        None => {
            let mut defaults = models.values().filter(|value| value.is_default);
            match (defaults.next(), defaults.next()) { (Some(value), None) => Some(value), _ => None }
        }
    }.ok_or_else(|| Failure::new(ErrorCode::Invalid, "Configured or default model is unavailable in this native engine; select an exact advertised model"))?;
    let effort = match &configured.effort {
        Some(value) => Some(value.clone()),
        None => supplied(effective, "model_reasoning_effort")?,
    }
    .unwrap_or_else(|| selected.default_effort.clone());
    if !selected.efforts.contains(&effort) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            format!(
                "Reasoning effort {effort} is unavailable for model {}; no model or effort was substituted",
                selected.model
            ),
        ));
    }
    Ok(Selection {
        model: selected.model.clone(),
        effort,
    })
}

async fn request(
    protocol: &impl Protocol,
    method: &str,
    params: &Value,
    cancellation: CancellationToken,
) -> Result<Value> {
    match protocol.request(method, params, cancellation).await? {
        Reply::Value(value) => Ok(value),
        Reply::Error(_) => Err(invalid(
            "Codex configuration or model catalog request failed",
        )),
    }
}

pub async fn admit(
    protocol: &impl Protocol,
    configured: &Options,
    cancellation: CancellationToken,
) -> Result<Selection> {
    let read = request(
        protocol,
        "config/read",
        &json!({"includeLayers":false}),
        cancellation.clone(),
    )
    .await?;
    let configuration = read
        .get("config")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("Codex did not expose its effective native configuration"))?;
    let mut models = BTreeMap::new();
    let mut cursors = BTreeSet::new();
    let mut cursor = None::<String>;
    loop {
        let mut parameters = json!({"includeHidden":true,"limit":100});
        if let Some(cursor) = &cursor {
            parameters["cursor"] = Value::String(cursor.clone());
        }
        let listing = request(protocol, "model/list", &parameters, cancellation.clone()).await?;
        let listing = object(&listing)?;
        let data = listing
            .get("data")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("Invalid or excessive native model catalog"))?;
        if models.len() + data.len() > 2000 || cursors.len() >= 2000 {
            return Err(invalid("Invalid or excessive native model catalog"));
        }
        for value in data {
            let model = model(value)?;
            if models.insert(model.model.clone(), model).is_some() {
                return Err(invalid(
                    "Ambiguous native model catalog or unsupported native default effort",
                ));
            }
        }
        cursor = match listing.get("nextCursor") {
            None | Some(Value::Null) => None,
            Some(Value::String(value))
                if !value.is_empty()
                    && value.encode_utf16().count() <= 4096
                    && !data.is_empty() =>
            {
                Some(value.clone())
            }
            _ => return Err(invalid("Invalid native model catalog pagination")),
        };
        let Some(next) = &cursor else {
            break;
        };
        if !cursors.insert(next.clone()) {
            return Err(invalid("Invalid native model catalog pagination"));
        }
    }
    select(configured, configuration, &models)
}
