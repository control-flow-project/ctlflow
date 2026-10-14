use crossfire_contracts::wake_up::{attachment, creation, schedule};
use crossfire_domain::schedule::Schedule;
use serde_json::json;

#[test]
fn scheduling_boundaries_reject_extra_fields_duplicates_and_unbounded_text()
-> Result<(), Box<dyn std::error::Error>> {
    assert_eq!(
        schedule(&json!({"kind":"interval","seconds":60}))?,
        Schedule::Interval { seconds: 60 }
    );
    assert!(schedule(&json!({"kind":"interval","seconds":60,"timeZone":"UTC"})).is_err());
    assert!(schedule(&json!({"kind":"interval","seconds":0})).is_err());
    assert!(
        schedule(&json!({"kind":"cron","expression":"* * * * *","timeZone":"UTC","extra":true}))
            .is_err()
    );
    let id = "00000000-0000-4000-8000-000000000001";
    let mut input = json!({"ruleId":id,"name":"Wake","message":"Scheduled message\nNext line", "enabled":true,"agentIds":[id],"schedule":{"kind":"interval","seconds":60}});
    assert!(creation(&input).is_ok());
    input["agentIds"] = json!([id, id]);
    assert!(creation(&input).is_err());
    input["agentIds"] = json!([]);
    input["message"] = json!("a".repeat(16_385));
    assert!(creation(&input).is_err());
    input["message"] = json!("   ");
    assert!(creation(&input).is_err());
    assert!(attachment(&json!({"runId":id,"sessionId":"native-history"})).is_ok());
    assert!(attachment(&json!({"runId":id,"sessionId":"native\nhistory"})).is_err());
    Ok(())
}
