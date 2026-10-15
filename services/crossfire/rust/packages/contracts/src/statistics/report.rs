use crate::statistics::TokensWire;
use crossfire_domain::{read::statistics::Report, statistics::Totals};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
fn totals(value: &Totals) -> Value {
    json!({"observed":value.observed,"delivered":value.delivered,"contentBytes":value.content_bytes,"deliveredBytes":value.delivered_bytes,"attachmentBytes":value.attachment_bytes,"largestBytes":value.largest_bytes})
}
pub fn report(value: &Report) -> Result<Value> {
    let measured = &value.measured;
    let agents=measured.agents.iter().map(|value_agent| {
        let identity=value.agents.get(&value_agent.agent_id).ok_or_else(||Failure::new(ErrorCode::Unavailable,"Statistics agent identity is missing"))?;
        Ok(json!({"agentId":value_agent.agent_id,"displayName":identity.display_name,"matrixUserId":identity.matrix_user_id,"totals":totals(&value_agent.totals),"tokens":value_agent.tokens.as_ref().map(TokensWire)}))
    }).collect::<Result<Vec<_>>>()?;
    Ok(
        json!({"capturedAt":value.captured_at,"since":value.since,"retentionDays":value.retention_days,"intervals":measured.intervals,"dropped":measured.dropped,"firstReportAt":measured.first_report_at,"lastReportAt":measured.last_report_at,
        "totals":totals(&measured.totals),"agents":agents,"flows":measured.flows.iter().map(|flow|json!({"agentId":flow.agent_id,"senderMatrixId":flow.flow.sender_matrix_id,"senderName":value.senders.get(&flow.flow.sender_matrix_id).cloned().flatten(),"roomId":flow.flow.room_id,"messageType":flow.flow.message_type,"totals":totals(&flow.flow.totals)})).collect::<Vec<_>>(),
        "meta":{"page":value.pagination.page,"pageSize":value.pagination.size,"totalItems":measured.total_flows,"totalPages":measured.total_flows.div_euclid(value.pagination.size).saturating_add(i64::from(measured.total_flows%value.pagination.size!=0)).max(1)},
        "tokens":measured.tokens.as_ref().map(TokensWire),"spend":null}),
    )
}
