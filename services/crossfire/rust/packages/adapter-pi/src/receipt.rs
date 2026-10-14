use crossfire_adapter_filesystem::owned::OwnedFile;
use crossfire_adapter_runtime::history::{self, Boundary};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

fn invalid() -> Failure {
    Failure::new(ErrorCode::Invalid, "Invalid Pi native history tree entry")
}
pub fn received(
    file: &Path,
    boundary: &Boundary,
    text: &str,
    message_id: &str,
    leaf: Option<&str>,
) -> Result<bool> {
    let mut parents = HashMap::new();
    let mut markers = HashSet::new();
    let mut users = HashSet::new();
    history::since(file, Some(boundary), |entry| {
        let value = entry.as_object().ok_or_else(invalid)?;
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        let parent = match value.get("parentId") {
            Some(Value::Null) => None,
            Some(Value::String(value)) => Some(value.clone()),
            _ => return Err(invalid()),
        };
        if parents.insert(id.to_owned(), parent.clone()).is_some() {
            return Err(invalid());
        }
        if value.get("type").and_then(Value::as_str) == Some("custom")
            && value.get("customType").and_then(Value::as_str) == Some("crossfire-input")
        {
            let data = value
                .get("data")
                .and_then(Value::as_object)
                .ok_or_else(invalid)?;
            if data.get("messageId").and_then(Value::as_str) == Some(message_id)
                && data.get("text").and_then(Value::as_str) == Some(text)
            {
                markers.insert(id.to_owned());
            }
        }
        if value.get("type").and_then(Value::as_str) == Some("message") {
            let message = value
                .get("message")
                .and_then(Value::as_object)
                .ok_or_else(invalid)?;
            if message.get("role").and_then(Value::as_str) == Some("user")
                && let Some(content) = message
                    .get("content")
                    .and_then(Value::as_array)
                    .filter(|value| value.len() == 1)
                    .and_then(|value| value[0].as_object())
                && content.get("type").and_then(Value::as_str) == Some("text")
                && content.get("text").and_then(Value::as_str) == Some(text)
                && parent
                    .as_ref()
                    .is_some_and(|parent| markers.contains(parent))
            {
                users.insert(id.to_owned());
            }
        }
        Ok(())
    })?;
    let mut visited = HashSet::new();
    let mut leaf = leaf;
    while let Some(id) = leaf {
        let Some(parent) = parents.get(id) else {
            break;
        };
        if !visited.insert(id) {
            return Err(invalid());
        }
        if users.contains(id) {
            OwnedFile::open(file, u64::MAX)?
                .ok_or_else(invalid)?
                .secure_and_sync()?;
            return Ok(true);
        }
        leaf = parent.as_deref();
    }
    Ok(false)
}
