use crossfire_domain::fleet::message::{Command, Snapshot, Summary};
use serde_json::{Value, json};
pub fn summary(value: &Summary) -> Value {
    json!({"messageId":value.message.id,"body":value.message.body,"createdAt":value.message.created_at,"expiresAt":value.message.expires_at,
        "total":value.total,"delivered":value.delivered,"failed":value.failed,"skipped":value.skipped,"pending":value.pending,"expired":value.expired})
}
pub fn command(value: &Command) -> Value {
    json!({"messageId":value.message.id,"fleetId":value.message.fleet_id,"body":value.message.body,"createdAt":value.message.created_at,"expiresAt":value.message.expires_at,
        "sender":{"kind":if value.sender_matrix_id.is_some(){"human"}else{"controller"},"matrixUserId":value.sender_matrix_id},"agentIds":value.agent_ids})
}
pub fn snapshot(value: &Snapshot) -> Value {
    let mut result = crate::views::control(&value.control);
    result["agentIds"] = json!(value.agent_ids);
    result["messages"] = value.messages.iter().map(command).collect();
    result["runtimeOperations"] = json!(
        value
            .runtime_operations
            .iter()
            .map(crate::fleet_runtime::OperationWire)
            .collect::<Vec<_>>()
    );
    result
}
