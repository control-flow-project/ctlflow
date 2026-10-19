use crate::validation as check;
use crossfire_domain::{
    messaging::{Membership, RoomFacts},
    room_access::{
        read::{GrantView, RoomDetails},
        values::*,
    },
};
use crossfire_kernel::Result;
use serde_json::{Value, json};
pub fn intent(value: &Value, removal: bool) -> Result<Intent> {
    if removal {
        return Ok(Intent {
            access: Access::None,
            native_access: None,
            muted: false,
        });
    }
    let access = match check::choice(&value["accessMode"], &["read", "reply", "custom"])? {
        "read" => Access::Read,
        "reply" => Access::Reply,
        _ => Access::Custom,
    };
    Ok(Intent {
        access,
        native_access: crate::messaging::native_access(&value["nativeAccess"])?,
        muted: check::boolean(&value["muted"])?,
    })
}
pub fn change(value: &Value, agent: &str, room: &str, removal: bool) -> Result<Change> {
    let required = if removal {
        vec!["expectedRevision", "expectedGeneration"]
    } else {
        vec![
            "expectedRevision",
            "expectedGeneration",
            "accessMode",
            "nativeAccess",
            "muted",
        ]
    };
    check::object(value, &required, &[])?;
    Ok(Change {
        agent_id: agent.to_owned(),
        room_id: room.to_owned(),
        expected_revision: check::integer(&value["expectedRevision"], 0, check::SAFE_INTEGER)?,
        expected_generation: if value["expectedGeneration"].is_null() {
            None
        } else {
            Some(check::identifier(&value["expectedGeneration"])?.to_owned())
        },
        intent: intent(value, removal)?,
    })
}
pub fn permissions(value: &Value, agent: &str, room: &str) -> Result<PermissionChange> {
    check::object(
        value,
        &["expectedRevision", "expectedGeneration", "permissions"],
        &[],
    )?;
    let permissions = check::list(&value["permissions"], 0, 1)?;
    for value in permissions {
        check::choice(value, &["room.agent.invite"])?;
    }
    Ok(PermissionChange {
        agent_id: agent.to_owned(),
        room_id: room.to_owned(),
        expected_revision: check::integer(&value["expectedRevision"], 0, check::SAFE_INTEGER)?,
        expected_generation: check::identifier(&value["expectedGeneration"])?.to_owned(),
        invite_agents: !permissions.is_empty(),
    })
}
pub fn grant(value: &Grant) -> Value {
    json!({"agentId":value.agent_id,"roomId":value.room_id,"generation":value.generation,"authorizerId":value.authorizer_id,"addedById":value.added_by_id,
        "accessMode":value.intent.access.code(),"nativeAccess":value.intent.native_access,"muted":value.intent.muted,"revision":value.revision,"accessRevision":value.access_revision,"updatedAt":value.updated_at})
}
pub fn membership(value: Membership) -> &'static str {
    match value {
        Membership::Join => "join",
        Membership::Invite => "invite",
        Membership::Leave => "leave",
        Membership::Ban => "ban",
    }
}
pub fn application(value: &Application) -> Value {
    json!({"observedGeneration":value.observed_generation,"appliedRevision":value.applied_revision,"appliedAccessRevision":value.applied_access_revision,
        "membership":value.membership.map(membership),"nativeAccess":value.native_access,"lastAttemptAt":value.last_attempt_at,"lastSuccessAt":value.last_success_at,
        "errorCode":value.error_code,"errorMessage":value.error_message})
}
pub fn grant_view(value: &GrantView) -> Value {
    json!({"agentId":value.agent_id,"revision":value.revision,"ownerConversation":value.owner_conversation,"grant":value.grant.as_ref().map(grant),
        "application":value.application.as_ref().map(application),"permissions":value.permissions,"allowedActions":value.allowed_actions})
}
pub fn authority(value: &RoomFacts) -> Value {
    json!({"backendUserId":value.backend_user_id,"canInvite":value.can_invite,"authorityRevision":value.authority_revision,"accessModes":value.access_modes,"accessFields":value.access_fields,"permissions":value.permissions})
}
pub fn room(value: &RoomDetails) -> Value {
    json!({"roomId":value.room_id,"name":value.name,"topic":value.topic,"alias":value.alias,"authority":value.authority.as_ref().map(authority)})
}
