use crate::validation as check;
use crossfire_domain::{
    agent::WakePolicyChange,
    identity::{Role, Status, WakeMode},
    member::Change,
    policy::InstancePolicy,
    wake::Sender,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;
pub fn status(value: &Value) -> Result<Status> {
    Ok(
        match check::choice(value, &["active", "suspended", "revoked"])? {
            "active" => Status::Active,
            "suspended" => Status::Suspended,
            _ => Status::Revoked,
        },
    )
}
pub fn revision(value: &Value) -> Result<i64> {
    check::integer(value, 0, check::SAFE_INTEGER)
}
pub fn member(value: &Value, role: bool) -> Result<Change> {
    let object = if role {
        check::object(value, &["expectedRevision", "roleCode"], &[])?
    } else {
        check::object(value, &["expectedRevision"], &["status", "displayName"])?
    };
    Ok(Change {
        expected_revision: revision(&object["expectedRevision"])?,
        status: object.get("status").map(status).transpose()?,
        display_name: object
            .get("displayName")
            .map(|value| check::text(value, 1, 100).map(str::to_owned))
            .transpose()?,
        role: if role {
            Some(
                if check::choice(&object["roleCode"], &["member", "administrator"])? == "member" {
                    Role::Member
                } else {
                    Role::Administrator
                },
            )
        } else {
            None
        },
    })
}
pub fn agent(value: &Value) -> Result<(i64, Option<Status>)> {
    let value = check::object(value, &["expectedRevision"], &["status"])?;
    Ok((
        revision(&value["expectedRevision"])?,
        value.get("status").map(status).transpose()?,
    ))
}
pub fn wake(value: &Value) -> Result<WakePolicyChange> {
    let value = check::object(value, &["expectedRevision", "mode", "senders"], &[])?;
    let mode = match check::choice(&value["mode"], &["humans", "everyone", "selected"])? {
        "humans" => WakeMode::Humans,
        "everyone" => WakeMode::Everyone,
        _ => WakeMode::Selected,
    };
    let senders = check::list(&value["senders"], 0, 2000)?
        .iter()
        .map(|value| {
            let value = check::object(value, &["principalId", "includeAgents"], &[])?;
            Ok(Sender {
                principal_id: check::identifier(&value["principalId"])?.to_owned(),
                include_agents: check::boolean(&value["includeAgents"])?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    if mode == WakeMode::Everyone && !senders.is_empty()
        || senders
            .iter()
            .map(|sender| &sender.principal_id)
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != senders.len()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Select unique identities; everyone requires no individual selections",
        ));
    }
    Ok(WakePolicyChange {
        expected_revision: revision(&value["expectedRevision"])?,
        mode,
        senders,
    })
}
pub fn policy(value: &Value) -> Result<InstancePolicy> {
    let value = check::object(
        value,
        &[
            "expectedRevision",
            "maxOwnerAgents",
            "maxAgents",
            "maxPending",
            "enrollmentSeconds",
            "reconcileSeconds",
            "maxMessageBytes",
            "fleetIdleTimeoutSeconds",
            "agentInstructions",
            "signupMode",
            "invitationIssuers",
        ],
        &[],
    )?;
    Ok(InstancePolicy {
        revision: revision(&value["expectedRevision"])?,
        max_owner_agents: check::integer(&value["maxOwnerAgents"], 1, 100)?,
        max_agents: check::integer(&value["maxAgents"], 1, 1000)?,
        max_pending: check::integer(&value["maxPending"], 1, 1000)?,
        enrollment_seconds: check::integer(&value["enrollmentSeconds"], 60, 3600)?,
        reconcile_seconds: check::integer(&value["reconcileSeconds"], 30, 3600)?,
        max_message_bytes: check::integer(&value["maxMessageBytes"], 4096, 4194304)?,
        fleet_idle_timeout_seconds: check::integer(&value["fleetIdleTimeoutSeconds"], 0, 604800)?,
        agent_instructions: check::plain_text(&value["agentInstructions"], 8192)?.to_owned(),
        signup_mode: check::choice(&value["signupMode"], &["invitation", "open"])?.to_owned(),
        invitation_issuers: check::choice(
            &value["invitationIssuers"],
            &["administrators", "members"],
        )?
        .to_owned(),
    })
}
