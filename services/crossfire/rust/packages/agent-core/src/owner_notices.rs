use crossfire_kernel::{Result, identity::hash};
use serde_json::Value;

pub trait Sink: Send + Sync {
    fn notice(&self, identity: &str, text: &str) -> Result<()>;
}
pub fn identity(value: &Value) -> Result<String> {
    let text = serde_json::to_string(value)
        .map_err(|_| crate::events::invalid("Owner notice identity cannot be encoded"))?;
    Ok(hash(&text))
}
