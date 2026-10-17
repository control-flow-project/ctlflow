use crate::validation as check;
use crossfire_domain::{identity::Status, room_access::values::Access};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::collections::BTreeSet;
pub struct Grant {
    pub room_id: String,
    pub access: Access,
    pub power: Option<i64>,
    pub muted: bool,
}
pub struct Policy {
    pub agent_id: String,
    pub matrix_user_id: String,
    pub owner_matrix_id: String,
    pub status: Status,
    pub owner_status: Status,
    pub owner_conversation: Option<String>,
    pub grants: Vec<Grant>,
    pub mode: crossfire_domain::identity::WakeMode,
    pub sender_matrix_ids: Vec<String>,
    pub max_message_bytes: usize,
    pub idle_timeout_seconds: u64,
}
fn status(value: &Value) -> Result<Status> {
    Ok(
        match check::choice(value, &["active", "suspended", "revoked"])? {
            "active" => Status::Active,
            "suspended" => Status::Suspended,
            _ => Status::Revoked,
        },
    )
}
pub fn parse(value: &Value) -> Result<Policy> {
    let value = check::object(
        value,
        &[
            "agentId",
            "matrixUserId",
            "ownerMatrixId",
            "status",
            "ownerStatus",
            "ownerConversation",
            "roomGrants",
            "wakeMode",
            "senderMatrixIds",
            "maxMessageBytes",
            "fleetIdleTimeoutSeconds",
        ],
        &[],
    )?;
    let grants = check::list(&value["roomGrants"], 0, 101)?
        .iter()
        .map(|value| {
            let value =
                check::object(value, &["roomId", "accessMode", "powerLevel", "muted"], &[])?;
            let access = match check::choice(&value["accessMode"], &["read", "reply", "custom"])? {
                "read" => Access::Read,
                "reply" => Access::Reply,
                _ => Access::Custom,
            };
            let power = if value["powerLevel"].is_null() {
                None
            } else {
                Some(check::integer(
                    &value["powerLevel"],
                    -check::SAFE_INTEGER,
                    check::SAFE_INTEGER,
                )?)
            };
            if (access == Access::Custom) != power.is_some() {
                return Err(invalid());
            }
            Ok(Grant {
                room_id: check::room_id(&value["roomId"])?,
                access,
                power,
                muted: check::boolean(&value["muted"])?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let senders = check::list(&value["senderMatrixIds"], 0, 2000)?
        .iter()
        .map(|value| check::matrix_user_id(value).map(str::to_owned))
        .collect::<Result<Vec<_>>>()?;
    let policy = Policy {
        agent_id: check::identifier(&value["agentId"])?.to_owned(),
        matrix_user_id: check::matrix_user_id(&value["matrixUserId"])?.to_owned(),
        owner_matrix_id: check::matrix_user_id(&value["ownerMatrixId"])?.to_owned(),
        status: status(&value["status"])?,
        owner_status: status(&value["ownerStatus"])?,
        owner_conversation: if value["ownerConversation"].is_null() {
            None
        } else {
            Some(check::room_id(&value["ownerConversation"])?)
        },
        grants,
        sender_matrix_ids: senders,
        max_message_bytes: check::integer(&value["maxMessageBytes"], 4096, 4194304)? as usize,
        idle_timeout_seconds: check::integer(&value["fleetIdleTimeoutSeconds"], 0, 604800)? as u64,
        mode: match check::choice(&value["wakeMode"], &["humans", "everyone", "selected"])? {
            "humans" => crossfire_domain::identity::WakeMode::Humans,
            "everyone" => crossfire_domain::identity::WakeMode::Everyone,
            _ => crossfire_domain::identity::WakeMode::Selected,
        },
    };
    if policy.sender_matrix_ids.contains(&policy.matrix_user_id)
        || policy
            .sender_matrix_ids
            .iter()
            .collect::<BTreeSet<_>>()
            .len()
            != policy.sender_matrix_ids.len()
        || policy
            .grants
            .iter()
            .map(|grant| &grant.room_id)
            .collect::<BTreeSet<_>>()
            .len()
            != policy.grants.len()
        || policy.owner_conversation.as_ref().is_some_and(|room| {
            !policy.grants.iter().any(|grant| {
                &grant.room_id == room && grant.access == Access::Reply && !grant.muted
            })
        })
        || (policy.status != Status::Active || policy.owner_status != Status::Active)
            && !policy.sender_matrix_ids.is_empty()
    {
        return Err(invalid());
    }
    Ok(policy)
}
pub fn value(value: &crossfire_domain::room_access::delivery::Policy) -> Value {
    let status = |value| match value {
        Status::Active => "active",
        Status::Suspended => "suspended",
        Status::Revoked => "revoked",
    };
    let mode = match value.agent.agent.wake_mode {
        crossfire_domain::identity::WakeMode::Humans => "humans",
        crossfire_domain::identity::WakeMode::Everyone => "everyone",
        crossfire_domain::identity::WakeMode::Selected => "selected",
    };
    json!({"agentId":value.agent.principal.id,"matrixUserId":value.agent.principal.matrix_user_id,"ownerMatrixId":value.agent.owner.matrix_user_id,"status":status(value.agent.principal.status),"ownerStatus":status(value.agent.owner.status),"ownerConversation":value.owner_conversation,
        "roomGrants":value.grants.iter().map(|grant| json!({"roomId":grant.room_id,"accessMode":grant.intent.access.code(),"powerLevel":grant.intent.power,"muted":grant.intent.muted})).collect::<Vec<_>>(),"wakeMode":mode,"senderMatrixIds":value.wake_senders,"maxMessageBytes":value.max_message_bytes,"fleetIdleTimeoutSeconds":value.idle_timeout_seconds})
}
fn invalid() -> Failure {
    Failure::new(ErrorCode::Invalid, "Invalid resolved delivery authority")
}
