use crossfire_contracts::validation as check;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::MAX_TIMESTAMP};
use fleetd_domain::model::*;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
};

pub fn registrations(value: &Value) -> Result<Vec<Registration>> {
    let values = check::list(value, 0, 100)?
        .iter()
        .map(|value| {
            let value = check::object(
                value,
                &[
                    "fleetId",
                    "fleetKey",
                    "directory",
                    "label",
                    "revision",
                    "digest",
                ],
                &[],
            )?;
            let record = Registration {
                fleet_id: check::identifier(&value["fleetId"])?.to_owned(),
                fleet_key: check::name(&value["fleetKey"])?.to_owned(),
                directory: PathBuf::from(check::text(&value["directory"], 1, 4096)?),
                label: check::text(&value["label"], 1, 100)?.to_owned(),
                revision: check::integer(&value["revision"], 0, check::SAFE_INTEGER)?,
                digest: check::text(&value["digest"], 64, 64)?.to_owned(),
            };
            if !record
                .directory
                .to_str()
                .is_some_and(crate::configuration::absolute_path)
                || !record
                    .digest
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Invalid fleet registration path or digest",
                ));
            }
            Ok(record)
        })
        .collect::<Result<Vec<_>>>()?;
    if values
        .iter()
        .map(|value| &value.fleet_id)
        .collect::<BTreeSet<_>>()
        .len()
        != values.len()
        || values
            .iter()
            .map(|value| &value.directory)
            .collect::<BTreeSet<_>>()
            .len()
            != values.len()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Duplicate private fleet registration",
        ));
    }
    if values
        .iter()
        .map(|value| &value.fleet_key)
        .collect::<BTreeSet<_>>()
        .len()
        != values.len()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Duplicate private fleet key",
        ));
    }
    Ok(values)
}
pub fn registrations_wire(values: &[Registration]) -> Value {
    Value::Array(values.iter().map(|value| json!({"fleetId":value.fleet_id,"fleetKey":value.fleet_key,"directory":value.directory,
        "label":value.label,"revision":value.revision,"digest":value.digest})).collect())
}
pub fn desired(value: &Value) -> Result<Vec<DesiredIntent>> {
    let mut values = check::list(value, 0, 10_000)?
        .iter()
        .map(|value| {
            let value = check::object(value, &["fleetId", "instanceKey"], &[])?;
            Ok(DesiredIntent {
                fleet_id: check::identifier(&value["fleetId"])?.to_owned(),
                instance_key: check::name(&value["instanceKey"])?.to_owned(),
            })
        })
        .collect::<Result<Vec<_>>>()?;
    values.sort_unstable();
    if values.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Duplicate desired binding",
        ));
    }
    let mut counts = BTreeMap::new();
    for value in &values {
        *counts.entry(&value.fleet_id).or_insert(0) += 1;
    }
    if counts.len() > 100 || counts.values().any(|count| *count > 100) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Controller supports at most 100 desired fleets with 100 bindings each",
        ));
    }
    Ok(values)
}
pub fn desired_wire(values: &[DesiredIntent]) -> Value {
    Value::Array(
        values
            .iter()
            .map(|value| json!({"fleetId":value.fleet_id,"instanceKey":value.instance_key}))
            .collect(),
    )
}
pub fn selections(value: &Value) -> Result<Vec<ResumeSelection>> {
    let mut values = check::list(value, 0, 100)?
        .iter()
        .map(|value| {
            let value = check::object(value, &["fleetId", "instanceKeys"], &[])?;
            let mut instance_keys = check::list(&value["instanceKeys"], 0, 100)?
                .iter()
                .map(|value| check::name(value).map(str::to_owned))
                .collect::<Result<Vec<_>>>()?;
            instance_keys.sort_unstable();
            if instance_keys.windows(2).any(|pair| pair[0] == pair[1]) {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Duplicate saved resume selection",
                ));
            }
            Ok(ResumeSelection {
                fleet_id: check::identifier(&value["fleetId"])?.to_owned(),
                instance_keys,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    values.sort_unstable_by(|first, second| first.fleet_id.cmp(&second.fleet_id));
    if values
        .windows(2)
        .any(|pair| pair[0].fleet_id == pair[1].fleet_id)
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Duplicate saved resume selection",
        ));
    }
    Ok(values)
}
pub fn selections_wire(values: &[ResumeSelection]) -> Value {
    Value::Array(
        values
            .iter()
            .map(|value| json!({"fleetId":value.fleet_id,"instanceKeys":value.instance_keys}))
            .collect(),
    )
}
pub fn work(value: &Value) -> Result<Vec<ResumeWork>> {
    let values = check::list(value, 0, 2002)?
        .iter()
        .map(|value| {
            let value = check::object(
                value,
                &["context", "sessionId", "messageId", "checkpointedAt"],
                &[],
            )?;
            Ok(ResumeWork {
                context: check::text(&value["context"], 1, 255)?.to_owned(),
                session_id: check::text(&value["sessionId"], 1, 200)?.to_owned(),
                message_id: check::identifier(&value["messageId"])?.to_owned(),
                checkpointed_at: check::integer(&value["checkpointedAt"], 0, MAX_TIMESTAMP)?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    if values
        .iter()
        .map(|value| &value.context)
        .collect::<BTreeSet<_>>()
        .len()
        != values.len()
        || values
            .iter()
            .map(|value| &value.message_id)
            .collect::<BTreeSet<_>>()
            .len()
            != values.len()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Duplicate interrupted native history",
        ));
    }
    Ok(values)
}
pub fn work_wire(values: &[ResumeWork]) -> Value {
    Value::Array(values.iter().map(|value| json!({"context":value.context,"sessionId":value.session_id,"messageId":value.message_id,"checkpointedAt":value.checkpointed_at})).collect())
}
