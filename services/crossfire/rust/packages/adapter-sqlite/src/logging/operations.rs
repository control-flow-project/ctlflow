use super::{ScanResult, scan_result};
use crate::store::Store;
use crate::{error::failure, tables::fleet_runtime_operation as operation};
use crossfire_domain::logging::Cursor;
use crossfire_kernel::Result;
use diesel::prelude::*;
use std::collections::HashMap;

#[derive(Queryable)]
struct Candidate {
    id: String,
    fleet_id: String,
    agent_id: Option<String>,
    action: String,
    status: String,
    at: i64,
}

pub(super) fn prune(
    store: &mut Store,
    cutoff: i64,
    limit: i64,
    cursor: Option<&Cursor>,
) -> Result<ScanResult> {
    let after = cursor.map_or(-9_007_199_254_740_991, |cursor| cursor.at);
    let id = cursor.map_or("", |cursor| cursor.id.as_str());
    let candidates = operation::table
        .filter(
            operation::status
                .eq_any(["succeeded", "failed"])
                .and(operation::completed_at.lt(cutoff))
                .and(
                    operation::completed_at
                        .gt(after)
                        .or(operation::completed_at.eq(after).and(operation::id.gt(id))),
                ),
        )
        .order((operation::completed_at.asc(), operation::id.asc()))
        .limit(limit)
        .select((
            operation::id,
            operation::fleet_id,
            operation::agent_id,
            operation::action,
            operation::status,
            operation::completed_at.assume_not_null(),
        ))
        .load::<Candidate>(store.database.connection())
        .map_err(failure)?;
    let mut latest: HashMap<(String, Option<String>), Option<String>> = HashMap::new();
    let mut removable = Vec::new();
    for candidate in &candidates {
        let mut current = false;
        if candidate.action == "stop" && candidate.status == "succeeded" {
            let key = (candidate.fleet_id.clone(), candidate.agent_id.clone());
            if !latest.contains_key(&key) {
                let scope = operation::agent_id
                    .eq(&candidate.agent_id)
                    .or(operation::agent_id.is_null().and(
                        candidate
                            .agent_id
                            .is_none()
                            .into_sql::<diesel::sql_types::Bool>(),
                    ));
                let id = operation::table
                    .filter(
                        operation::fleet_id
                            .eq(&candidate.fleet_id)
                            .and(scope)
                            .and(operation::action.eq("stop"))
                            .and(operation::status.eq("succeeded")),
                    )
                    .order((operation::completed_at.desc(), operation::id.desc()))
                    .select(operation::id)
                    .first::<String>(store.database.connection())
                    .optional()
                    .map_err(failure)?;
                latest.insert(key.clone(), id);
            }
            current = latest.get(&key).and_then(Option::as_deref) == Some(&candidate.id);
        }
        if !current {
            removable.push(candidate.id.clone());
        }
    }
    diesel::delete(operation::table.filter(operation::id.eq_any(&removable)))
        .execute(store.database.connection())
        .map_err(failure)?;
    let scanned: Vec<_> = candidates
        .into_iter()
        .map(|candidate| (candidate.id, candidate.at))
        .collect();
    Ok(scan_result(&scanned, removable.len(), limit))
}
