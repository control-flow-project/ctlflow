use crossfire_contracts::fleet_runtime;
use serde_json::json;

#[test]
fn fresh_history_is_explicit_and_receipt_status_requires_the_corresponding_error() {
    let mut request = json!({"operationId":"00000000-0000-0000-0000-000000000001", "agentId":null, "action":"start", "expectedRevision":0, "confirmFreshHistory":false});
    assert!(fleet_runtime::request(&request).is_ok());
    request["action"] = json!("reset");
    assert!(fleet_runtime::request(&request).is_err());
    request["confirmFreshHistory"] = json!(true);
    assert!(fleet_runtime::request(&request).is_ok());
    request["unsupported"] = json!(true);
    assert!(fleet_runtime::request(&request).is_err());
    let mut receipt = json!({"connectionId":"00000000-0000-0000-0000-000000000002", "status":"succeeded", "errorMessage":null});
    assert!(fleet_runtime::receipt(&receipt).is_ok());
    receipt["status"] = json!("failed");
    assert!(fleet_runtime::receipt(&receipt).is_err());
    receipt["errorMessage"] = json!("Native execution failed");
    assert!(fleet_runtime::receipt(&receipt).is_ok());
    receipt["status"] = json!("running");
    assert!(fleet_runtime::receipt(&receipt).is_err());
}
