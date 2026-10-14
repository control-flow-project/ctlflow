use crossfire_adapter_codex::{
    decisions,
    protocol::{Event, Request, RequestId},
    usage,
};
use serde_json::{Value, json};

fn request(method: &str, params: Value) -> Request {
    Request {
        method: method.to_owned(),
        id: RequestId::Number(7),
        params: params.as_object().cloned().unwrap_or_default(),
    }
}

#[test]
fn native_question_keeps_exact_attribution_choices_and_lifetime()
-> Result<(), Box<dyn std::error::Error>> {
    let request = request(
        "item/tool/requestUserInput",
        json!({"threadId":"session","turnId":"turn","itemId":"item","isBlocking":true,"autoResolutionMs":30000,"questions":[{"id":"decision","header":"Choose","question":"Which option?","isOther":false,"isSecret":false,"options":[{"label":"A","description":"First"},{"label":"B","description":"Second"}]}]}),
    );
    let decision = decisions::question(&request, "session")?;
    assert_eq!(decision.request_id, "[\"number\",7]");
    assert_eq!(decision.turn_id.as_deref(), Some("turn"));
    assert_eq!(decision.item_id.as_deref(), Some("item"));
    assert_eq!(decision.expires_ms, Some(30000));
    assert!(decisions::available_answer(
        &decision,
        &json!({"answers":{"decision":{"answers":["B"]}}})
    ));
    assert!(!decisions::available_answer(
        &decision,
        &json!({"answers":{"decision":{"answers":["not offered"]}}})
    ));
    assert!(!decisions::available_answer(
        &decision,
        &json!({"answers":{"decision":{"answers":["A","B"]}}})
    ));
    assert!(decisions::question(&request, "another-session").is_err());
    Ok(())
}

#[test]
fn native_questions_allow_explicit_free_text_but_reject_duplicate_or_malformed_choices()
-> Result<(), Box<dyn std::error::Error>> {
    let mut request = request(
        "item/tool/requestUserInput",
        json!({"threadId":"session","turnId":"turn","itemId":"item","isBlocking":false,"questions":[{"id":"password","header":"Input","question":"Supply privately","isOther":false,"isSecret":true,"options":null}]}),
    );
    let decision = decisions::question(&request, "session")?;
    assert!(
        decision
            .questions
            .as_ref()
            .is_some_and(|questions| questions[0].secret && questions[0].allow_text)
    );
    assert!(decisions::available_answer(
        &decision,
        &json!({"answers":{"password":{"answers":["private answer"]}}})
    ));
    let first = request.params["questions"][0].clone();
    request.params["questions"] = json!([first, first]);
    assert!(decisions::question(&request, "session").is_err());
    request.params["questions"][0]["options"] = json!(false);
    assert!(decisions::question(&request, "session").is_err());
    Ok(())
}

#[test]
fn native_approval_never_invents_choices_or_grants_a_permission()
-> Result<(), Box<dyn std::error::Error>> {
    let mut request = request(
        "item/commandExecution/requestApproval",
        json!({"threadId":"session","turnId":"turn","itemId":"item","command":"git status","cwd":"/workspace","availableDecisions":["accept","decline",{"acceptWithExecpolicyAmendment":{"execpolicy_amendment":["git","status"]}}]}),
    );
    let decision = decisions::permission(&request, "session", None)?;
    assert_eq!(decision.choices.len(), 3);
    assert!(decisions::available_answer(
        &decision,
        &json!({"decision":"accept"})
    ));
    assert!(!decisions::available_answer(
        &decision,
        &json!({"decision":"acceptForSession"})
    ));
    assert_eq!(
        decisions::denial(&decision).and_then(|value| value["decision"].as_str()),
        Some("decline")
    );
    request.params["availableDecisions"] = json!(["accept", "accept"]);
    assert!(decisions::permission(&request, "session", None).is_err());
    request.params["availableDecisions"] = json!([{"applyNetworkPolicyAmendment":{"network_policy_amendment":{"host":"example.com","action":"allow"}}}]);
    assert_eq!(
        decisions::permission(&request, "session", None)?
            .choices
            .len(),
        1
    );
    request.params["availableDecisions"][0]["applyNetworkPolicyAmendment"]["network_policy_amendment"]
        ["action"] = json!("unexpected");
    assert!(decisions::permission(&request, "session", None).is_err());
    Ok(())
}

#[test]
fn file_changes_are_exact_evidence_not_a_twelve_kilobyte_approval_notification()
-> Result<(), Box<dyn std::error::Error>> {
    let request = request(
        "item/fileChange/requestApproval",
        json!({"threadId":"session","turnId":"turn","itemId":"file"}),
    );
    let changes = json!([{"path":"report.txt","diff":"x".repeat(100000)}]);
    let decision = decisions::permission(&request, "session", Some(&changes))?;
    assert_eq!(
        decision.scope["changes"][0]["diff"].as_str().map(str::len),
        Some(100000)
    );
    assert_eq!(decision.choices.len(), 4);
    assert!(decisions::permission(&request, "session", None).is_err());
    assert!(
        decisions::permission(&request, "session", Some(&json!([{"path":"report.txt"}]))).is_err()
    );
    Ok(())
}

#[test]
fn cumulative_native_usage_is_attributed_and_corrupt_statistics_are_ignored() {
    let mut event = Event { method: "thread/tokenUsage/updated".to_owned(), params: json!({"threadId":"session","tokenUsage":{"total":{"inputTokens":500,"cachedInputTokens":400,"outputTokens":50,"reasoningOutputTokens":20,"totalTokens":550}}}).as_object().cloned().unwrap_or_default() };
    let sample = usage::sample(&event, "session");
    assert_eq!(
        sample.as_ref().map(|sample| sample.tokens.cached_input),
        Some(400)
    );
    assert!(
        sample
            .as_ref()
            .is_some_and(|sample| sample.tokens.cache_write_input.is_none())
    );
    assert!(usage::sample(&event, "another-session").is_none());
    event.params["tokenUsage"]["total"]["cachedInputTokens"] = json!(900);
    assert!(usage::sample(&event, "session").is_none());
}
