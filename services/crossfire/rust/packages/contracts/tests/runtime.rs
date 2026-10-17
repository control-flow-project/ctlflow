use crossfire_contracts::runtime::{self, DecisionWire, ObservationWire};
use crossfire_domain::runtime::values::*;
use serde_json::{Value, json};

fn decision() -> Value {
    json!({"id":"00000000-0000-0000-0000-000000000001", "runId":"00000000-0000-0000-0000-000000000002", "runtime":"codex", "sessionId":"session", "requestId":"request", "turnId":"turn", "itemId":"item", "kind":"permission", "action":"approve", "review":"private review", "blocking":true, "expiresAt":null,
        "questions":[{"id":"question", "title":"Allow", "prompt":"Proceed?", "secret":false, "allowText":false, "options":[{"id":"allow", "label":"Allow", "description":"Proceed"}]}]})
}

#[test]
fn native_decisions_keep_the_full_review_and_reject_unknown_or_unimplemented_inputs()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut input = decision();
    input["review"] = json!("x".repeat(26_036));
    let parsed = runtime::decision(&input)?;
    assert_eq!(parsed.review.len(), 26_036);
    let value = Decision {
        summary: DecisionSummary {
            header: parsed.header.clone(),
            agent_id: "00000000-0000-0000-0000-000000000003".to_owned(),
            status: DecisionStatus::Pending,
            created_at: 1,
        },
        review: parsed.review,
        questions: parsed.questions,
    };
    let wire = serde_json::to_value(DecisionWire(&value))?;
    assert!(wire["review"] == input["review"]);
    assert!(wire["questions"] == input["questions"]);
    assert_eq!(wire["status"], "pending");
    assert!(wire.get("header").is_none());
    input["runtime"] = json!("claude");
    assert!(runtime::decision(&input).is_err());
    input["runtime"] = json!("pi");
    assert!(runtime::decision(&input).is_ok());
    input["invented"] = json!(true);
    assert!(runtime::decision(&input).is_err());
    let mut input = decision();
    input["questions"] = json!([]);
    assert!(runtime::decision(&input).is_err());
    let input = json!({"answers":[{"questionId":"question", "optionId":"allow", "text":null}]});
    assert_eq!(runtime::answers(&input)?.len(), 1);
    assert!(runtime::answers(&json!({"answers":[]})).is_err());
    Ok(())
}

#[test]
fn observation_round_trip_preserves_native_settings_activity_and_history_scope()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut input = json!({"sessionId":"session", "roomId":null, "runtime":"pi", "state":"waiting-answer", "observedAt":10, "lastActivityAt":9, "historyAvailable":true,
        "historyMode":"per-room", "maxInputBytes":65536, "settings":[{"name":"thinking_level", "configured":"high", "effective":"high"}], "errorMessage":null});
    let parsed = runtime::observation(&input)?;
    let view = ObservationView {
        run_id: "00000000-0000-0000-0000-000000000002".to_owned(),
        observation: parsed,
    };
    let mut wire = serde_json::to_value(ObservationWire(&view))?;
    wire.as_object_mut()
        .ok_or("Invalid serialized object")?
        .remove("runId");
    assert!(wire == input);
    input["maxInputBytes"] = json!(1023);
    assert!(runtime::observation(&input).is_err());
    input["maxInputBytes"] = json!(4 * 1024 * 1024 + 1);
    assert!(runtime::observation(&input).is_err());
    input["maxInputBytes"] = json!(65536);
    input["state"] = json!("stopped");
    assert!(runtime::observation(&input).is_err());
    Ok(())
}
