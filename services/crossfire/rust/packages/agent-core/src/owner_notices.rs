use crossfire_kernel::{Result, identity::hash};
use serde_json::{Value, json};

pub const BYTES: usize = 12000;
pub trait Sink: Send + Sync {
    fn notice(&self, identity: &str, text: &str) -> Result<()>;
}
pub fn chunks(text: &str) -> impl Iterator<Item = &str> {
    let mut remaining = text;
    std::iter::from_fn(move || {
        if remaining.is_empty() {
            return None;
        }
        let mut end = remaining.len().min(BYTES);
        while !remaining.is_char_boundary(end) {
            end -= 1;
        }
        let (part, next) = remaining.split_at(end);
        remaining = next;
        Some(part)
    })
}
pub fn identity(value: &Value) -> Result<String> {
    let text = serde_json::to_string(value)
        .map_err(|_| crate::events::invalid("Owner notice identity cannot be encoded"))?;
    Ok(hash(&text))
}
pub fn content(text: &str) -> Value {
    json!({"msgtype":"m.notice","body":text,"org.crossfire.listener_notice":true})
}
