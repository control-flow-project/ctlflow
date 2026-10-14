#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PrincipalKind {
    Human,
    Agent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Active,
    Suspended,
    Revoked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WakeMode {
    Humans,
    Everyone,
    Selected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Member,
    Administrator,
    Agent,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Principal {
    pub id: String,
    pub matrix_user_id: String,
    pub kind: PrincipalKind,
    pub status: Status,
    pub revision: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub principal_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Agent {
    pub principal_id: String,
    pub owner_id: String,
    pub wake_mode: WakeMode,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentCredential {
    pub agent_id: String,
    pub provisioning_password: crossfire_kernel::secret::Secret,
    pub access_token: Option<crossfire_kernel::secret::Secret>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrincipalRole {
    pub principal_id: String,
    pub principal_kind: PrincipalKind,
    pub role: Role,
    pub assigned_by_member_id: Option<String>,
    pub assigned_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Application {
    pub principal_id: String,
    pub applied_revision: Option<i64>,
    pub applied_intent_hash: Option<String>,
    pub applied_status: Option<Status>,
    pub native_display_name: Option<String>,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub next_check_at: i64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberView {
    pub principal: Principal,
    pub member: Member,
    pub role: PrincipalRole,
    pub application: Application,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentView {
    pub principal: Principal,
    pub agent: Agent,
    pub owner: Principal,
    pub owner_member: Member,
    pub application: Application,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberSession {
    pub secret_hash: String,
    pub member_id: String,
    pub csrf_secret: crossfire_kernel::secret::Secret,
    pub native_access_token: crossfire_kernel::secret::Secret,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Authentication {
    Management { session_hash: String },
    Native { matrix_user_id: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Actor {
    pub principal_id: String,
    pub kind: PrincipalKind,
    pub authentication: Option<Authentication>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentBinding {
    pub agent_id: String,
    pub retired_at: Option<i64>,
    pub fleet_archived_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub page: i64,
    pub page_size: i64,
    pub total_items: i64,
    pub total_pages: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrincipalSummary {
    pub principal_id: String,
    pub matrix_user_id: String,
    pub kind: PrincipalKind,
    pub display_name: String,
    pub owner_id: String,
    pub owner_matrix_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActiveIdentity {
    pub principal: Principal,
    pub owner_id: Option<String>,
}

pub fn agent_display_name(name: &str, owner_name: &str) -> String {
    format!("{name} ({owner_name})")
}

pub fn pending_application(principal_id: String, now: i64) -> Application {
    Application {
        principal_id,
        applied_revision: None,
        applied_intent_hash: None,
        applied_status: None,
        native_display_name: None,
        last_attempt_at: None,
        last_success_at: None,
        next_check_at: now,
        error_code: None,
        error_message: None,
    }
}
