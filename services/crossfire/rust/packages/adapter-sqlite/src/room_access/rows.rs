use crate::tables::{
    agent_owner_conversation, agent_room_grant, agent_room_permission, room_grant_application,
};
use crossfire_domain::{matrix::Membership, room_access::values::*};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;
pub(super) fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Unavailable,
        "Invalid stored room authorization state",
    )
}
fn boolean(value: i64) -> Result<bool> {
    match value {
        0 => Ok(false),
        1 => Ok(true),
        _ => Err(invalid()),
    }
}
#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = agent_room_grant,treat_none_as_null = true)]
pub(super) struct GrantRow {
    agent_id: String,
    room_id: String,
    generation: String,
    authorizer_id: String,
    added_by_id: String,
    invitation_event_id: Option<String>,
    admission_kind: String,
    access_mode: String,
    power_level: Option<i64>,
    muted: i64,
    revision: i64,
    access_revision: i64,
    updated_at: i64,
}
impl From<&Grant> for GrantRow {
    fn from(value: &Grant) -> Self {
        Self {
            agent_id: value.agent_id.clone(),
            room_id: value.room_id.clone(),
            generation: value.generation.clone(),
            authorizer_id: value.authorizer_id.clone(),
            added_by_id: value.added_by_id.clone(),
            invitation_event_id: value.invitation_event_id.clone(),
            admission_kind: match value.admission {
                Admission::Managed => "managed",
                Admission::Invitation => "invitation",
            }
            .to_owned(),
            access_mode: value.intent.access.code().to_owned(),
            power_level: value.intent.power,
            muted: i64::from(value.intent.muted),
            revision: value.revision,
            access_revision: value.access_revision,
            updated_at: value.updated_at,
        }
    }
}
impl TryFrom<GrantRow> for Grant {
    type Error = Failure;
    fn try_from(value: GrantRow) -> Result<Self> {
        let access = match value.access_mode.as_str() {
            "none" => Access::None,
            "read" => Access::Read,
            "reply" => Access::Reply,
            "custom" => Access::Custom,
            _ => return Err(invalid()),
        };
        let admission = match value.admission_kind.as_str() {
            "managed" => Admission::Managed,
            "invitation" => Admission::Invitation,
            _ => return Err(invalid()),
        };
        Ok(Self {
            agent_id: value.agent_id,
            room_id: value.room_id,
            generation: value.generation,
            authorizer_id: value.authorizer_id,
            added_by_id: value.added_by_id,
            invitation_event_id: value.invitation_event_id,
            admission,
            intent: Intent {
                access,
                power: value.power_level,
                muted: boolean(value.muted)?,
            },
            revision: value.revision,
            access_revision: value.access_revision,
            updated_at: value.updated_at,
        })
    }
}
#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = agent_room_permission)]
pub(super) struct PermissionRow {
    agent_id: String,
    room_id: String,
    generation: String,
    permission_code: String,
    grant_scope: String,
    granted_by_member_id: String,
    granted_at: i64,
}
impl From<&Permission> for PermissionRow {
    fn from(value: &Permission) -> Self {
        Self {
            agent_id: value.agent_id.clone(),
            room_id: value.room_id.clone(),
            generation: value.generation.clone(),
            permission_code: "room.agent.invite".to_owned(),
            grant_scope: "agent_room".to_owned(),
            granted_by_member_id: value.granted_by_member_id.clone(),
            granted_at: value.granted_at,
        }
    }
}
impl TryFrom<PermissionRow> for Permission {
    type Error = Failure;
    fn try_from(value: PermissionRow) -> Result<Self> {
        if value.permission_code != "room.agent.invite" || value.grant_scope != "agent_room" {
            return Err(invalid());
        }
        Ok(Self {
            agent_id: value.agent_id,
            room_id: value.room_id,
            generation: value.generation,
            granted_by_member_id: value.granted_by_member_id,
            granted_at: value.granted_at,
        })
    }
}
#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = room_grant_application,treat_none_as_null = true)]
pub(super) struct ApplicationRow {
    agent_id: String,
    room_id: String,
    observed_generation: Option<String>,
    applied_revision: Option<i64>,
    applied_access_revision: Option<i64>,
    membership: Option<String>,
    creator: i64,
    power_level: Option<i64>,
    last_attempt_at: Option<i64>,
    last_success_at: Option<i64>,
    next_check_at: i64,
    error_code: Option<String>,
    error_message: Option<String>,
}
impl From<&Application> for ApplicationRow {
    fn from(value: &Application) -> Self {
        Self {
            agent_id: value.agent_id.clone(),
            room_id: value.room_id.clone(),
            observed_generation: value.observed_generation.clone(),
            applied_revision: value.applied_revision,
            applied_access_revision: value.applied_access_revision,
            membership: value.membership.map(|value| {
                match value {
                    Membership::Join => "join",
                    Membership::Invite => "invite",
                    Membership::Leave => "leave",
                    Membership::Ban => "ban",
                }
                .to_owned()
            }),
            creator: i64::from(value.creator),
            power_level: value.power,
            last_attempt_at: value.last_attempt_at,
            last_success_at: value.last_success_at,
            next_check_at: value.next_check_at,
            error_code: value.error_code.clone(),
            error_message: value.error_message.clone(),
        }
    }
}
impl TryFrom<ApplicationRow> for Application {
    type Error = Failure;
    fn try_from(value: ApplicationRow) -> Result<Self> {
        let membership = value
            .membership
            .map(|value| match value.as_str() {
                "join" => Ok(Membership::Join),
                "invite" => Ok(Membership::Invite),
                "leave" => Ok(Membership::Leave),
                "ban" => Ok(Membership::Ban),
                _ => Err(invalid()),
            })
            .transpose()?;
        Ok(Self {
            agent_id: value.agent_id,
            room_id: value.room_id,
            observed_generation: value.observed_generation,
            applied_revision: value.applied_revision,
            applied_access_revision: value.applied_access_revision,
            membership,
            creator: boolean(value.creator)?,
            power: value.power_level,
            last_attempt_at: value.last_attempt_at,
            last_success_at: value.last_success_at,
            next_check_at: value.next_check_at,
            error_code: value.error_code,
            error_message: value.error_message,
        })
    }
}
#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = agent_owner_conversation)]
pub(super) struct OwnerRow {
    agent_id: String,
    owner_id: String,
    room_id: String,
    created_at: i64,
}
impl From<&OwnerConversation> for OwnerRow {
    fn from(value: &OwnerConversation) -> Self {
        Self {
            agent_id: value.agent_id.clone(),
            owner_id: value.owner_id.clone(),
            room_id: value.room_id.clone(),
            created_at: value.created_at,
        }
    }
}
impl From<OwnerRow> for OwnerConversation {
    fn from(value: OwnerRow) -> Self {
        Self {
            agent_id: value.agent_id,
            owner_id: value.owner_id,
            room_id: value.room_id,
            created_at: value.created_at,
        }
    }
}
