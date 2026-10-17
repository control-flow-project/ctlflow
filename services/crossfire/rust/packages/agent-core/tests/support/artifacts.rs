use crossfire_agent_core::{chat::Artifacts, events::Event};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;

pub struct Inline;
impl Artifacts for Inline {
    fn stage(&self, events: Vec<Event>) -> Result<Vec<Event>> {
        Ok(events)
    }
    fn prepare(
        &self,
        _events: &[Event],
        text: String,
        _message: &str,
        maximum: usize,
        _metadata: &Value,
    ) -> Result<String> {
        if text.len() > maximum {
            Err(Failure::new(
                ErrorCode::Limit,
                "Fixture requires real artifact storage for large data",
            ))
        } else {
            Ok(text)
        }
    }
    fn release(&self, _messages: &[String]) -> Result<()> {
        Ok(())
    }
}
