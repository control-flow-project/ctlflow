use crate::protocol::Protocol;
use crossfire_agent_core::runtime::{Decision, Hooks};
use crossfire_contracts::{runtime, validation};
use crossfire_domain::runtime::values::Runtime;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::collections::HashSet;
use tokio_util::sync::CancellationToken;

fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Invalid,
        "Invalid native Pi owner question or answer",
    )
}
pub fn question(event: &Value, session: &str, turn: &str) -> Result<Decision> {
    let id = validation::text(event.get("id").ok_or_else(invalid)?, 1, 255)?;
    let title = event
        .get("title")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let method = validation::choice(
        event.get("method").ok_or_else(invalid)?,
        &["confirm", "select", "input", "editor"],
    )?;
    let options = match method {
        "confirm" => vec![json!("Yes"), json!("No")],
        "select" => validation::list(event.get("options").ok_or_else(invalid)?, 1, 100)?.to_vec(),
        _ => Vec::new(),
    };
    let mut seen = HashSet::new();
    for option in &options {
        let option = validation::text(option, 1, 1000)?;
        if !seen.insert(option) {
            return Err(invalid());
        }
    }
    let (title, suffix) = title.split_once('\n').unwrap_or((title, title));
    let prompt = ["message", "placeholder", "prefill"]
        .into_iter()
        .find_map(|name| event.get(name).and_then(Value::as_str))
        .unwrap_or(suffix);
    let value = json!({"id":id,"title":title,"prompt":prompt,"secret":false,"allowText":matches!(method,"input"|"editor"),"options":options.iter().enumerate().map(|(index,label)| json!({"id":index.to_string(),"label":label,"description":""})).collect::<Vec<_>>()});
    let question = runtime::question(&value)?;
    let expires_ms = event
        .get("timeout")
        .map(|value| validation::integer(value, 0, 2_147_483_647))
        .transpose()?
        .filter(|value| *value > 0);
    Ok(Decision {
        runtime: Runtime::Pi,
        session_id: session.to_owned(),
        request_id: id.to_owned(),
        action: "Human input".to_owned(),
        scope: json!({"method":method,"questions":[value]}),
        choices: Vec::new(),
        questions: Some(vec![question]),
        turn_id: Some(turn.to_owned()),
        item_id: Some(id.to_owned()),
        blocking: Some(true),
        expires_ms,
    })
}
pub async fn answer(
    native: &impl Protocol,
    hooks: &impl Hooks,
    decision: &Decision,
    cancellation: CancellationToken,
) -> Result<()> {
    let response = hooks.request_decision(decision, cancellation.clone()).await;
    crossfire_adapter_runtime::clock::check(&cancellation)?;
    let response = match response {
        Ok(response) => response,
        Err(_) => return native
            .notify(
                &json!({"type":"extension_ui_response","id":decision.request_id,"cancelled":true}),
                cancellation,
            )
            .await,
    };
    let answers = response
        .get("answers")
        .and_then(Value::as_object)
        .filter(|value| value.len() == 1)
        .ok_or_else(invalid)?;
    let answer = answers
        .get(&decision.request_id)
        .and_then(|value| value.get("answers"))
        .and_then(Value::as_array)
        .filter(|value| value.len() == 1)
        .and_then(|value| value[0].as_str())
        .ok_or_else(invalid)?;
    let question = decision
        .questions
        .as_ref()
        .filter(|value| value.len() == 1)
        .and_then(|value| value.first())
        .ok_or_else(invalid)?;
    if !question.allow_text && !question.options.iter().any(|option| option.label == answer) {
        return Err(invalid());
    }
    let mut response = json!({"type":"extension_ui_response","id":decision.request_id});
    if decision.scope.get("method").and_then(Value::as_str) == Some("confirm") {
        response["confirmed"] = json!(answer == "Yes");
    } else {
        response["value"] = json!(answer);
    }
    native.notify(&response, cancellation).await?;
    hooks.decision_responded(decision);
    Ok(())
}
