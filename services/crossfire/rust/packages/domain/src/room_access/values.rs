use crate::messaging::{Membership, RoomFacts};
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Access {
    None,
    Read,
    Reply,
    Custom,
}
impl Access {
    pub fn code(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Read => "read",
            Self::Reply => "reply",
            Self::Custom => "custom",
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    Managed,
    Invitation,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Intent {
    pub access: Access,
    pub native_access: Option<serde_json::Map<String, serde_json::Value>>,
    pub muted: bool,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Grant {
    pub agent_id: String,
    pub room_id: String,
    pub generation: String,
    pub authorizer_id: String,
    pub added_by_id: String,
    pub invitation_event_id: Option<String>,
    pub admission: Admission,
    pub intent: Intent,
    pub revision: i64,
    pub access_revision: i64,
    pub updated_at: i64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Permission {
    pub agent_id: String,
    pub room_id: String,
    pub generation: String,
    pub granted_by_member_id: String,
    pub granted_at: i64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Application {
    pub agent_id: String,
    pub room_id: String,
    pub observed_generation: Option<String>,
    pub applied_revision: Option<i64>,
    pub applied_access_revision: Option<i64>,
    pub membership: Option<Membership>,
    pub native_access: Option<serde_json::Map<String, serde_json::Value>>,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub next_check_at: i64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}
impl Application {
    pub fn pending(agent: &str, room: &str, now: i64) -> Self {
        Self {
            agent_id: agent.to_owned(),
            room_id: room.to_owned(),
            observed_generation: None,
            applied_revision: None,
            applied_access_revision: None,
            membership: None,
            native_access: None,
            last_attempt_at: None,
            last_success_at: None,
            next_check_at: now,
            error_code: None,
            error_message: None,
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerConversation {
    pub agent_id: String,
    pub owner_id: String,
    pub room_id: String,
    pub created_at: i64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovedPolicy {
    pub agent_id: String,
    pub approved_by_member_id: String,
    pub approved_at: i64,
    pub invite_agents: bool,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Change {
    pub agent_id: String,
    pub room_id: String,
    pub expected_revision: i64,
    pub expected_generation: Option<String>,
    pub intent: Intent,
}
pub struct PermissionChange {
    pub agent_id: String,
    pub room_id: String,
    pub expected_revision: i64,
    pub expected_generation: String,
    pub invite_agents: bool,
}
pub struct Authorization {
    pub input: Change,
    pub previous: Option<Grant>,
    pub actor_revision: i64,
    pub target_revision: i64,
    pub owner_revision: i64,
    pub inviter_generation: Option<String>,
    pub inviter_revision: Option<i64>,
    pub authorizer_id: String,
    pub native: Option<RoomFacts>,
    pub changed: bool,
    pub invitation_event_id: Option<String>,
    pub admission: Admission,
}
