use crossfire_adapter_codex::{
    admission::{self, Model},
    capability,
    options::{self, ApprovalPolicy, NativeOptions, Sandbox},
};
use crossfire_agent_core::runtime::Approval;
use serde_json::json;
use std::collections::BTreeMap;

#[test]
fn native_options_are_strict_normalized_and_never_silently_substituted()
-> Result<(), Box<dyn std::error::Error>> {
    let parsed = options::parse(&json!({}))?;
    assert_eq!(parsed.sandbox, Sandbox::DangerFullAccess);
    assert_eq!(parsed.approval_policy, ApprovalPolicy::OnRequest);
    assert_eq!(parsed.approval_policy.routing(), Approval::Listener);
    assert_eq!(
        serde_json::to_value(NativeOptions(&parsed))?,
        json!({"sandbox_mode":"danger-full-access","approval_policy":"on-request"})
    );
    let bypass = options::parse(
        &json!({"dangerously_bypass_approvals_and_sandbox":true,"model":"selected","model_reasoning_effort":"max","features":{}}),
    )?;
    assert_eq!(bypass.approval_policy.routing(), Approval::None);
    assert_eq!(
        serde_json::to_value(NativeOptions(&bypass))?["features"],
        json!({})
    );
    assert!(
        serde_json::to_value(NativeOptions(&bypass))?
            .get("dangerously_bypass_approvals_and_sandbox")
            .is_none()
    );
    for value in [
        json!({"api_key":"forbidden"}),
        json!({"model_reasoning_effort":"very-high"}),
        json!({"model":null}),
        json!({"features":{"unknown":true}}),
        json!({"dangerously_bypass_approvals_and_sandbox":true,"sandbox_mode":"read-only"}),
        json!({"dangerously_bypass_approvals_and_sandbox":true,"approval_policy":"on-request"}),
    ] {
        assert!(options::parse(&value).is_err());
    }
    Ok(())
}

#[test]
fn native_approval_grants_have_one_exact_owner_and_schema() -> Result<(), Box<dyn std::error::Error>>
{
    assert_eq!(options::native_approval(&json!("never"))?, Approval::None);
    assert_eq!(
        options::native_approval(&json!("on-request"))?,
        Approval::Listener
    );
    let mut granular = json!({"granular":{"sandbox_approval":false,"rules":false,"skill_approval":false,"request_permissions":false,"mcp_elicitations":false}});
    assert_eq!(options::native_approval(&granular)?, Approval::None);
    granular["granular"]["request_permissions"] = json!(true);
    assert_eq!(options::native_approval(&granular)?, Approval::Listener);
    granular["granular"]["extra"] = json!(false);
    assert!(options::native_approval(&granular).is_err());
    assert!(options::native_approval(&json!("approve-everything")).is_err());
    Ok(())
}

#[test]
fn exact_advertised_models_and_efforts_are_required() -> Result<(), Box<dyn std::error::Error>> {
    let model = admission::model(
        &json!({"model":"advertised","isDefault":true,"defaultReasoningEffort":"high","supportedReasoningEfforts":[{"reasoningEffort":"high"},{"reasoningEffort":"max"}]}),
    )?;
    let models = BTreeMap::from([(model.model.clone(), model)]);
    assert_eq!(
        admission::select(
            &options::parse(&json!({}))?,
            &serde_json::Map::new(),
            &models
        )?
        .effort,
        "high"
    );
    let chosen = options::parse(&json!({"model":"advertised","model_reasoning_effort":"max"}))?;
    let malformed_unselected = json!({"model":true,"model_reasoning_effort":17});
    assert_eq!(
        admission::select(
            &chosen,
            malformed_unselected.as_object().ok_or("Missing config")?,
            &models
        )?
        .effort,
        "max"
    );
    assert!(
        admission::select(
            &options::parse(&json!({"model":"unknown"}))?,
            &serde_json::Map::new(),
            &models
        )
        .is_err()
    );
    assert!(
        admission::select(
            &options::parse(&json!({"model_reasoning_effort":"low"}))?,
            &serde_json::Map::new(),
            &models
        )
        .is_err()
    );
    let invalid = json!({"model":"advertised","isDefault":true,"defaultReasoningEffort":"max","supportedReasoningEfforts":[{"reasoningEffort":"high"}]});
    assert!(admission::model(&invalid).is_err());
    let additional = Model {
        model: "other".to_owned(),
        is_default: true,
        default_effort: "high".to_owned(),
        efforts: ["high".to_owned()].into_iter().collect(),
    };
    let mut ambiguous = models;
    ambiguous.insert(additional.model.clone(), additional);
    assert!(
        admission::select(
            &options::parse(&json!({}))?,
            &serde_json::Map::new(),
            &ambiguous
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn actual_native_version_and_instruction_capabilities_are_required()
-> Result<(), Box<dyn std::error::Error>> {
    for value in ["codex-cli 0.158.0", "codex-cli 0.162.1", "codex-cli 1.0.0"] {
        options::version(value)?;
    }
    for value in [
        "codex-cli 0.157.99",
        "codex-cli 0.162.1-preview",
        "0.162.1",
        "codex-cli 0.162",
    ] {
        assert!(options::version(value).is_err());
    }
    options::question_capability(
        "other stable false\ndefault_mode_request_user_input beta true\n",
    )?;
    assert!(
        options::question_capability(
            "default_mode_request_user_input beta true\ndefault_mode_request_user_input beta false"
        )
        .is_err()
    );
    let mut schema = json!({"definitions":{"ThreadInjectItemsParams":{"type":"object","properties":{"items":{"type":"array"},"threadId":{"type":"string"}},"required":["items","threadId"]}},"oneOf":[{"properties":{"method":{"enum":["thread/inject_items"]},"params":{"$ref":"#/definitions/ThreadInjectItemsParams"}}}]});
    capability::instructions(&schema)?;
    schema["definitions"]["ThreadInjectItemsParams"]["required"] = json!(["threadId"]);
    assert!(capability::instructions(&schema).is_err());
    Ok(())
}
