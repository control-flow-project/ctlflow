use serde_json::{Map, Value};

pub fn valid(value: &Map<String, Value>) -> bool {
    value.len() <= 64
        && value.values().all(|value| valid_value(value, 1))
        && serde_json::to_vec(value).is_ok_and(|bytes| bytes.len() <= 8192)
}

fn valid_value(value: &Value, depth: usize) -> bool {
    depth <= 64
        && match value {
            Value::Array(values) => values.iter().all(|value| valid_value(value, depth + 1)),
            Value::Object(values) => values.values().all(|value| valid_value(value, depth + 1)),
            _ => true,
        }
}
