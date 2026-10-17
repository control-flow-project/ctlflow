use crate::protocol::Event;
use crossfire_contracts::statistics;
use crossfire_domain::statistics::Usage;
use serde_json::{Value, json};

pub fn sample(event: &Event, session: &str) -> Option<Usage> {
    if event.method != "thread/tokenUsage/updated"
        || event.params.get("threadId").and_then(Value::as_str) != Some(session)
    {
        return None;
    }
    let total = event.params.get("tokenUsage")?.get("total")?.as_object()?;
    let tokens = statistics::tokens(&json!({"input":total.get("inputTokens"),"cachedInput":total.get("cachedInputTokens"),"cacheWriteInput":total.get("cacheWriteInputTokens"),"output":total.get("outputTokens"),"reasoningOutput":total.get("reasoningOutputTokens"),"total":total.get("totalTokens")})).ok()?;
    Some(Usage {
        runtime: "codex".to_owned(),
        session_id: session.to_owned(),
        tokens,
    })
}
