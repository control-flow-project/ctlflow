use crate::protocol::{Request, RequestId};
use crossfire_agent_core::runtime::{Choice, Decision};
use crossfire_contracts::{runtime, validation as check};
use crossfire_domain::runtime::values::Runtime;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::collections::HashSet;

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}

fn attribution(request: &Request, session: &str) -> Result<(String, String, String)> {
    if request.params.get("threadId").and_then(Value::as_str) != Some(session) {
        return Err(invalid("Native decision belongs to another session"));
    }
    let field = |key| {
        check::text(
            request
                .params
                .get(key)
                .ok_or_else(|| invalid("Invalid native decision attribution"))?,
            1,
            255,
        )
        .map(str::to_owned)
    };
    let identity = match &request.id {
        RequestId::Number(value) => json!(["number", value]),
        RequestId::Text(value) => json!(["string", value]),
    };
    Ok((
        field("turnId")?,
        field("itemId")?,
        serde_json::to_string(&identity)
            .map_err(|_| invalid("Invalid native decision identity"))?,
    ))
}

pub fn question(request: &Request, session: &str) -> Result<Decision> {
    let (turn, item, identity) = attribution(request, session)?;
    if request.method != "item/tool/requestUserInput" {
        return Err(invalid("Unsupported native question request"));
    }
    let values = check::list(
        request
            .params
            .get("questions")
            .ok_or_else(|| invalid("Missing native questions"))?,
        1,
        100,
    )?;
    let mut questions = Vec::with_capacity(values.len());
    let mut identities = HashSet::new();
    let mut scopes = Vec::with_capacity(values.len());
    for value in values {
        let value = value
            .as_object()
            .ok_or_else(|| invalid("Invalid native question"))?;
        let other = value
            .get("isOther")
            .and_then(Value::as_bool)
            .ok_or_else(|| invalid("Invalid native question"))?;
        let options = match value.get("options") {
            Some(Value::Array(values)) if values.len() <= 100 => values.iter().enumerate().map(|(index, value)| {
                let value = value.as_object().ok_or_else(|| invalid("Invalid native question option"))?;
                Ok(json!({"id":index.to_string(),"label":value.get("label"),"description":value.get("description")}))
            }).collect::<Result<Vec<_>>>()?,
            Some(Value::Null) => Vec::new(),
            _ => return Err(invalid("Invalid native question options")),
        };
        let scope = json!({"id":value.get("id"),"title":value.get("header"),"prompt":value.get("question"),"secret":value.get("isSecret"),"allowText":other || value.get("options") == Some(&Value::Null),"options":options});
        let question = runtime::question(&scope)?;
        if !identities.insert(question.id.clone()) {
            return Err(invalid("Duplicate native question"));
        }
        scopes.push(scope);
        questions.push(question);
    }
    let blocking = request
        .params
        .get("isBlocking")
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid("Invalid native question lifetime"))?;
    let expires = match request.params.get("autoResolutionMs") {
        None | Some(Value::Null) => None,
        Some(value) => Some(check::integer(value, 0, check::SAFE_INTEGER)?),
    };
    Ok(Decision {
        runtime: Runtime::Codex,
        session_id: session.to_owned(),
        request_id: identity,
        action: "Human input".to_owned(),
        scope: json!({"questions":scopes}),
        choices: Vec::new(),
        turn_id: Some(turn),
        item_id: Some(item),
        blocking: Some(blocking),
        expires_ms: expires,
        questions: Some(questions),
    })
}

pub fn valid_answer(decision: &Decision, response: &Value) -> bool {
    let Some(answers) = response.get("answers").and_then(Value::as_object) else {
        return false;
    };
    let Some(questions) = &decision.questions else {
        return false;
    };
    answers.len() == questions.len()
        && questions.iter().all(|question| {
            let Some(answer) = answers
                .get(&question.id)
                .and_then(|value| value.get("answers"))
                .and_then(Value::as_array)
                .filter(|value| value.len() == 1)
                .and_then(|value| value[0].as_str())
            else {
                return false;
            };
            question.allow_text || question.options.iter().any(|option| option.label == answer)
        })
}

fn choice(value: &Value) -> Result<Choice> {
    if let Some(value) = value.as_str() {
        let label = match value {
            "accept" => "approve once",
            "acceptForSession" => "approve session",
            "decline" => "deny",
            "cancel" => "cancel turn",
            _ => return Err(invalid("Unsupported native permission decision")),
        };
        return Ok(Choice {
            label: label.to_owned(),
            value: json!({"decision":value}),
        });
    }
    let value = value
        .as_object()
        .filter(|value| value.len() == 1)
        .ok_or_else(|| invalid("Unsupported native permission decision"))?;
    if let Some(amendment) = value.get("acceptWithExecpolicyAmendment") {
        let amendment = check::object(amendment, &["execpolicy_amendment"], &[])?;
        let command = check::list(&amendment["execpolicy_amendment"], 1, 100)?;
        for part in command {
            check::text(part, 1, 4096)?;
        }
        return Ok(Choice {
            label: "apply command rule".to_owned(),
            value: json!({"decision":value}),
        });
    }
    if let Some(amendment) = value.get("applyNetworkPolicyAmendment") {
        let amendment = check::object(amendment, &["network_policy_amendment"], &[])?;
        let rule = check::object(
            &amendment["network_policy_amendment"],
            &["host", "action"],
            &[],
        )?;
        check::text(&rule["host"], 1, 255)?;
        let action = check::choice(&rule["action"], &["allow", "deny"])?;
        return Ok(Choice {
            label: if action == "allow" {
                "allow network rule"
            } else {
                "deny network rule"
            }
            .to_owned(),
            value: json!({"decision":value}),
        });
    }
    Err(invalid("Invalid native permission amendment"))
}

fn native_text(value: Option<&Value>, maximum: usize) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| !value.is_empty() && value.len() <= maximum && !value.contains('\0'))
}

pub fn permission(request: &Request, session: &str, changes: Option<&Value>) -> Result<Decision> {
    let (turn, item, identity) = attribution(request, session)?;
    let (available, action, scope) = match request.method.as_str() {
        "item/commandExecution/requestApproval" => {
            if !native_text(request.params.get("command"), 8 * 1024 * 1024) {
                return Err(invalid("Native command approval needs its exact command"));
            }
            check::text(
                request
                    .params
                    .get("cwd")
                    .ok_or_else(|| invalid("Missing native command workspace"))?,
                1,
                4096,
            )?;
            let choices = check::list(
                request
                    .params
                    .get("availableDecisions")
                    .ok_or_else(|| invalid("Missing native permission choices"))?,
                1,
                16,
            )?
            .to_vec();
            (
                choices,
                "command execution",
                Value::Object(request.params.clone()),
            )
        }
        "item/fileChange/requestApproval" => {
            let changes = changes
                .ok_or_else(|| invalid("Native file approval needs the exact pending changes"))?;
            let files = changes
                .as_array()
                .filter(|value| !value.is_empty())
                .ok_or_else(|| invalid("Invalid native file approval changes"))?;
            for file in files {
                let file = file
                    .as_object()
                    .ok_or_else(|| invalid("Invalid native file change"))?;
                check::text(
                    file.get("path")
                        .ok_or_else(|| invalid("Missing native file path"))?,
                    1,
                    4096,
                )?;
                if !file.get("diff").is_some_and(Value::is_string) {
                    return Err(invalid("Missing native file diff"));
                }
            }
            (
                vec![
                    json!("accept"),
                    json!("acceptForSession"),
                    json!("decline"),
                    json!("cancel"),
                ],
                "file changes",
                json!({"request":request.params,"changes":changes}),
            )
        }
        _ => return Err(invalid("Unsupported native permission request")),
    };
    let mut labels = HashSet::new();
    let choices = available
        .iter()
        .map(|value| {
            let value = choice(value)?;
            if !labels.insert(value.label.clone()) {
                return Err(invalid("Duplicate native permission choices"));
            }
            Ok(value)
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Decision {
        runtime: Runtime::Codex,
        session_id: session.to_owned(),
        request_id: identity,
        action: action.to_owned(),
        scope,
        choices,
        turn_id: Some(turn),
        item_id: Some(item),
        blocking: Some(true),
        expires_ms: None,
        questions: None,
    })
}

pub fn denial(decision: &Decision) -> Option<&Value> {
    decision
        .choices
        .iter()
        .find(|choice| {
            matches!(
                choice.value.get("decision").and_then(Value::as_str),
                Some("decline" | "cancel")
            )
        })
        .map(|choice| &choice.value)
}

pub fn available_answer(decision: &Decision, response: &Value) -> bool {
    if decision.questions.is_some() {
        valid_answer(decision, response)
    } else {
        decision
            .choices
            .iter()
            .any(|choice| choice.value == *response)
    }
}
