use crate::{
    error::failure,
    rows,
    store::Store,
    tables::{enrollment_item_permission, enrollment_item_policy, enrollment_item_wake_sender},
};
use crossfire_domain::{coordination::RequestedPolicy, enrollment::values::Item, wake::Sender};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;
use std::collections::BTreeMap;
pub(super) fn insert(store: &mut Store, item: &Item, value: &RequestedPolicy) -> Result<()> {
    diesel::insert_into(enrollment_item_policy::table)
        .values((
            enrollment_item_policy::request_id.eq(&item.request_id),
            enrollment_item_policy::instance_key.eq(&item.instance_key),
            enrollment_item_policy::wake_mode.eq(rows::wake_text(value.mode)),
            enrollment_item_policy::expected_agent_revision.eq(value.expected_agent_revision),
        ))
        .execute(store.database.connection())
        .map_err(failure)?;
    if value.invite_agents {
        diesel::insert_into(enrollment_item_permission::table)
            .values((
                enrollment_item_permission::request_id.eq(&item.request_id),
                enrollment_item_permission::instance_key.eq(&item.instance_key),
                enrollment_item_permission::permission_code.eq("room.agent.invite"),
                enrollment_item_permission::grant_scope.eq("agent_room"),
            ))
            .execute(store.database.connection())
            .map_err(failure)?;
    }
    for sender in &value.senders {
        diesel::insert_into(enrollment_item_wake_sender::table)
            .values((
                enrollment_item_wake_sender::request_id.eq(&item.request_id),
                enrollment_item_wake_sender::instance_key.eq(&item.instance_key),
                enrollment_item_wake_sender::sender_principal_id.eq(&sender.principal_id),
                enrollment_item_wake_sender::include_agents.eq(i64::from(sender.include_agents)),
            ))
            .execute(store.database.connection())
            .map_err(failure)?;
    }
    Ok(())
}
pub(super) fn read(store: &mut Store, id: &str) -> Result<BTreeMap<String, RequestedPolicy>> {
    let policies = enrollment_item_policy::table
        .filter(enrollment_item_policy::request_id.eq(id))
        .select((
            enrollment_item_policy::instance_key,
            enrollment_item_policy::wake_mode,
            enrollment_item_policy::expected_agent_revision,
        ))
        .load::<(String, String, Option<i64>)>(store.database.connection())
        .map_err(failure)?;
    let mut result = policies
        .into_iter()
        .map(|(key, mode, revision)| {
            Ok((
                key,
                RequestedPolicy {
                    mode: rows::wake(&mode)?,
                    senders: Vec::new(),
                    invite_agents: false,
                    expected_agent_revision: revision,
                },
            ))
        })
        .collect::<Result<BTreeMap<_, _>>>()?;
    let senders = enrollment_item_wake_sender::table
        .filter(enrollment_item_wake_sender::request_id.eq(id))
        .order(enrollment_item_wake_sender::sender_principal_id.asc())
        .select((
            enrollment_item_wake_sender::instance_key,
            enrollment_item_wake_sender::sender_principal_id,
            enrollment_item_wake_sender::include_agents,
        ))
        .load::<(String, String, i64)>(store.database.connection())
        .map_err(failure)?;
    for (key, principal_id, flag) in senders {
        let include_agents = match flag {
            0 => false,
            1 => true,
            _ => return Err(corrupt()),
        };
        result
            .get_mut(&key)
            .ok_or_else(corrupt)?
            .senders
            .push(Sender {
                principal_id,
                include_agents,
            });
    }
    for (key, code, scope) in enrollment_item_permission::table
        .filter(enrollment_item_permission::request_id.eq(id))
        .select((
            enrollment_item_permission::instance_key,
            enrollment_item_permission::permission_code,
            enrollment_item_permission::grant_scope,
        ))
        .load::<(String, String, String)>(store.database.connection())
        .map_err(failure)?
    {
        if code != "room.agent.invite" || scope != "agent_room" {
            return Err(corrupt());
        }
        result.get_mut(&key).ok_or_else(corrupt)?.invite_agents = true;
    }
    Ok(result)
}
fn corrupt() -> Failure {
    Failure::new(
        ErrorCode::Unavailable,
        "Invalid stored enrollment coordination policy",
    )
}
