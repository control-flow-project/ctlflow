use crate::validation as check;
use crossfire_domain::statistics::*;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;
use std::collections::HashSet;

fn count(value: &Value) -> Result<i64> {
    check::integer(value, 0, check::SAFE_INTEGER)
}
fn nullable(value: &Value) -> Result<Option<i64>> {
    if value.is_null() {
        Ok(None)
    } else {
        count(value).map(Some)
    }
}

pub fn tokens(value: &Value) -> Result<Tokens> {
    let object = check::object(
        value,
        &[
            "input",
            "cachedInput",
            "cacheWriteInput",
            "output",
            "reasoningOutput",
            "total",
        ],
        &[],
    )?;
    let value = Tokens {
        input: count(&object["input"])?,
        cached_input: count(&object["cachedInput"])?,
        cache_write_input: nullable(&object["cacheWriteInput"])?,
        output: count(&object["output"])?,
        reasoning_output: nullable(&object["reasoningOutput"])?,
        total: count(&object["total"])?,
    };
    if !value.valid() {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Token subsets exceed their parent counts",
        ));
    }
    Ok(value)
}

fn flow(value: &Value) -> Result<Flow> {
    let object = check::object(
        value,
        &[
            "roomId",
            "senderMatrixId",
            "messageType",
            "observed",
            "delivered",
            "contentBytes",
            "deliveredBytes",
            "attachmentBytes",
            "largestBytes",
        ],
        &[],
    )?;
    Ok(Flow {
        room_id: check::room_id(&object["roomId"])?,
        sender_matrix_id: check::matrix_user_id(&object["senderMatrixId"])?.to_owned(),
        message_type: check::text(&object["messageType"], 1, 100)?.to_owned(),
        totals: Totals {
            observed: count(&object["observed"])?,
            delivered: count(&object["delivered"])?,
            content_bytes: count(&object["contentBytes"])?,
            delivered_bytes: count(&object["deliveredBytes"])?,
            attachment_bytes: count(&object["attachmentBytes"])?,
            largest_bytes: count(&object["largestBytes"])?,
        },
    })
}

pub fn batch(value: &Value) -> Result<Batch> {
    let object = check::object(
        value,
        &[
            "sequence",
            "startedAt",
            "endedAt",
            "dropped",
            "flows",
            "usage",
        ],
        &[],
    )?;
    let value = Batch {
        sequence: check::integer(&object["sequence"], 1, check::SAFE_INTEGER)?,
        started_at: count(&object["startedAt"])?,
        ended_at: count(&object["endedAt"])?,
        dropped: count(&object["dropped"])?,
        flows: check::list(&object["flows"], 0, MAX_FLOWS)?
            .iter()
            .map(flow)
            .collect::<Result<Vec<_>>>()?,
        usage: check::list(&object["usage"], 0, MAX_SESSIONS)?
            .iter()
            .map(|value| {
                let object = check::object(value, &["runtime", "sessionId", "tokens"], &[])?;
                Ok(Usage {
                    runtime: check::text(&object["runtime"], 1, 100)?.to_owned(),
                    session_id: check::text(&object["sessionId"], 1, 255)?.to_owned(),
                    tokens: tokens(&object["tokens"])?,
                })
            })
            .collect::<Result<Vec<_>>>()?,
    };
    let mut flows = HashSet::new();
    let mut usage = HashSet::new();
    if value.ended_at < value.started_at
        || value
            .flows
            .iter()
            .any(|flow| !flows.insert((&flow.room_id, &flow.sender_matrix_id, &flow.message_type)))
        || value
            .usage
            .iter()
            .any(|sample| !usage.insert((&sample.runtime, &sample.session_id)))
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid interval or duplicate summaries",
        ));
    }
    Ok(value)
}
