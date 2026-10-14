use super::{MAX_FRAME_BYTES, error};
use crate::protocol::{Event, NativeError, Reply, Request, RequestId};
use crossfire_contracts::validation::{self, SAFE_INTEGER};
use crossfire_kernel::Result;
use serde_json::Value;

pub(super) enum Frame {
    Event(Event),
    Request(Request),
    Reply(i64, Reply),
}

pub(super) fn method(value: &str) -> Result<()> {
    if value.is_empty()
        || value.encode_utf16().count() > 200
        || value
            .chars()
            .any(|value| value <= '\u{1f}' || value == '\u{7f}')
    {
        return Err(error("Invalid native Codex method"));
    }
    Ok(())
}

pub(super) fn identity(value: &Value) -> Result<RequestId> {
    match value {
        Value::String(value) => Ok(RequestId::Text(value.clone())),
        _ => validation::integer(value, -SAFE_INTEGER, SAFE_INTEGER)
            .map(RequestId::Number)
            .map_err(|_| error("Invalid native request identity")),
    }
}

pub(super) fn decode(bytes: &[u8]) -> Result<Frame> {
    if bytes.len() > MAX_FRAME_BYTES {
        return Err(error("Codex frame exceeds its native resource bound"));
    }
    let value: Value =
        serde_json::from_slice(bytes).map_err(|_| error("Invalid native Codex JSON"))?;
    let Value::Object(mut fields) = value else {
        return Err(error("Invalid Codex protocol object"));
    };
    if let Some(value) = fields.remove("method") {
        let Value::String(name) = value else {
            return Err(error("Invalid native Codex method"));
        };
        method(&name)?;
        let Some(Value::Object(params)) = fields.remove("params") else {
            return Err(error("Invalid native Codex event parameters"));
        };
        return match fields.get("id") {
            Some(id) => Ok(Frame::Request(Request {
                id: identity(id)?,
                method: name,
                params,
            })),
            None => Ok(Frame::Event(Event {
                method: name,
                params,
            })),
        };
    }
    let id = fields
        .get("id")
        .ok_or_else(|| error("Invalid Codex response identity"))?;
    let id = validation::integer(id, 1, SAFE_INTEGER)
        .map_err(|_| error("Invalid Codex response identity"))?;
    let reply = match (fields.remove("result"), fields.remove("error")) {
        (Some(value), None) => Reply::Value(value),
        (None, Some(Value::Object(mut fields))) => {
            let code = fields
                .remove("code")
                .and_then(|value| value.as_i64())
                .ok_or_else(|| error("Invalid Codex protocol error"))?;
            let Some(Value::String(message)) = fields.remove("message") else {
                return Err(error("Invalid Codex protocol error"));
            };
            Reply::Error(NativeError { code, message })
        }
        _ => {
            return Err(error(
                "Codex response must contain exactly one result or error",
            ));
        }
    };
    Ok(Frame::Reply(id, reply))
}

pub(super) fn id_value(value: &RequestId) -> Value {
    match value {
        RequestId::Number(value) => Value::from(*value),
        RequestId::Text(value) => Value::String(value.clone()),
    }
}
