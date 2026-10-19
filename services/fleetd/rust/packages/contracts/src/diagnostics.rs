use crossfire_contracts::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use fleetd_domain::diagnostics::{Report, Scope};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub fn query(query: &BTreeMap<&str, &str>) -> Result<Scope> {
    let fleet = query
        .get("fleetId")
        .map(|value| check::identifier(&json!(value)).map(str::to_owned))
        .transpose()?;
    let instance = query
        .get("instanceKey")
        .map(|value| check::name(&json!(value)).map(str::to_owned))
        .transpose()?;
    if instance.is_some() && fleet.is_none() {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "An instance requires a fleet",
        ));
    }
    Ok(Scope {
        fleet_id: fleet,
        instance_key: instance,
    })
}
fn scope(value: &Scope) -> Value {
    json!({"fleetId":value.fleet_id,"instanceKey":value.instance_key})
}
pub fn value(value: &Report) -> Value {
    json!({"checkedAt":value.checked_at,"scope":scope(&value.scope),"checks":value.checks.iter().map(|check| json!({"id":check.id,"scope":scope(&check.scope),"status":check.status,"observedAt":check.observed_at,"message":check.message,"remediation":check.remediation})).collect::<Vec<_>>()})
}
