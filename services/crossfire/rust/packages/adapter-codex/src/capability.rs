use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;

pub fn instructions(value: &Value) -> Result<()> {
    let definition = value
        .get("definitions")
        .and_then(|value| value.get("ThreadInjectItemsParams"));
    let properties = definition.and_then(|value| value.get("properties"));
    let valid = definition
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str)
        == Some("object")
        && properties
            .and_then(|value| value.get("items"))
            .and_then(|value| value.get("type"))
            .and_then(Value::as_str)
            == Some("array")
        && properties
            .and_then(|value| value.get("threadId"))
            .and_then(|value| value.get("type"))
            .and_then(Value::as_str)
            == Some("string")
        && definition
            .and_then(|value| value.get("required"))
            .and_then(Value::as_array)
            .is_some_and(|items| {
                ["items", "threadId"]
                    .into_iter()
                    .all(|name| items.iter().any(|value| value.as_str() == Some(name)))
            })
        && value
            .get("oneOf")
            .and_then(Value::as_array)
            .is_some_and(|methods| {
                methods.iter().any(|value| {
                    let fields = value.get("properties");
                    fields
                        .and_then(|value| value.get("method"))
                        .and_then(|value| value.get("enum"))
                        .and_then(Value::as_array)
                        .is_some_and(|names| {
                            names.len() == 1 && names[0].as_str() == Some("thread/inject_items")
                        })
                        && fields
                            .and_then(|value| value.get("params"))
                            .and_then(|value| value.get("$ref"))
                            .and_then(Value::as_str)
                            == Some("#/definitions/ThreadInjectItemsParams")
                })
            });
    if valid {
        Ok(())
    } else {
        Err(Failure::new(
            ErrorCode::Native,
            "Install a native Codex release supporting experimental thread/inject_items developer instructions, then repeat fleet setup",
        ))
    }
}
