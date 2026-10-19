use crate::tables;
use crossfire_domain::identity::{
    Application, Member, MemberView, Principal, PrincipalKind, PrincipalRole, Role, Status,
    WakeMode,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = tables::principal)]
pub(crate) struct PrincipalRow {
    pub id: String,
    pub backend_user_id: String,
    pub kind: String,
    pub status: String,
    pub revision: i64,
    pub created_at: i64,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = tables::member)]
pub(crate) struct MemberRow {
    pub principal_id: String,
    pub principal_kind: String,
    pub display_name: String,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = tables::principal_role, treat_none_as_null = true)]
pub(crate) struct RoleRow {
    pub principal_id: String,
    pub principal_kind: String,
    pub role_code: String,
    pub assigned_by_member_id: Option<String>,
    pub assigned_at: i64,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = tables::principal_application, treat_none_as_null = true)]
pub(crate) struct ApplicationRow {
    pub principal_id: String,
    pub applied_revision: Option<i64>,
    pub applied_intent_hash: Option<String>,
    pub applied_status: Option<String>,
    pub native_display_name: Option<String>,
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    pub next_check_at: i64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
}

pub(crate) fn kind(value: &str) -> Result<PrincipalKind> {
    match value {
        "human" => Ok(PrincipalKind::Human),
        "agent" => Ok(PrincipalKind::Agent),
        _ => Err(corrupt()),
    }
}
pub(crate) fn status(value: &str) -> Result<Status> {
    match value {
        "active" => Ok(Status::Active),
        "suspended" => Ok(Status::Suspended),
        "revoked" => Ok(Status::Revoked),
        _ => Err(corrupt()),
    }
}
pub(crate) fn role(value: &str) -> Result<Role> {
    match value {
        "member" => Ok(Role::Member),
        "administrator" => Ok(Role::Administrator),
        "agent" => Ok(Role::Agent),
        _ => Err(corrupt()),
    }
}
pub(crate) fn wake(value: &str) -> Result<WakeMode> {
    match value {
        "humans" => Ok(WakeMode::Humans),
        "everyone" => Ok(WakeMode::Everyone),
        "selected" => Ok(WakeMode::Selected),
        _ => Err(corrupt()),
    }
}
pub(crate) fn kind_text(value: PrincipalKind) -> &'static str {
    match value {
        PrincipalKind::Human => "human",
        PrincipalKind::Agent => "agent",
    }
}
pub(crate) fn wake_text(value: WakeMode) -> &'static str {
    match value {
        WakeMode::Humans => "humans",
        WakeMode::Everyone => "everyone",
        WakeMode::Selected => "selected",
    }
}
pub(crate) fn status_text(value: Status) -> &'static str {
    match value {
        Status::Active => "active",
        Status::Suspended => "suspended",
        Status::Revoked => "revoked",
    }
}
pub(crate) fn role_text(value: Role) -> &'static str {
    match value {
        Role::Member => "member",
        Role::Administrator => "administrator",
        Role::Agent => "agent",
    }
}
fn corrupt() -> Failure {
    Failure::new(
        ErrorCode::Unavailable,
        "Stored identity discriminant is invalid",
    )
}

impl TryFrom<PrincipalRow> for Principal {
    type Error = Failure;
    fn try_from(row: PrincipalRow) -> Result<Self> {
        Ok(Self {
            id: row.id,
            backend_user_id: row.backend_user_id,
            kind: kind(&row.kind)?,
            status: status(&row.status)?,
            revision: row.revision,
            created_at: row.created_at,
        })
    }
}

impl From<&Principal> for PrincipalRow {
    fn from(value: &Principal) -> Self {
        Self {
            id: value.id.clone(),
            backend_user_id: value.backend_user_id.clone(),
            kind: kind_text(value.kind).to_owned(),
            status: status_text(value.status).to_owned(),
            revision: value.revision,
            created_at: value.created_at,
        }
    }
}

impl From<&Application> for ApplicationRow {
    fn from(value: &Application) -> Self {
        Self {
            principal_id: value.principal_id.clone(),
            applied_revision: value.applied_revision,
            applied_intent_hash: value.applied_intent_hash.clone(),
            applied_status: value
                .applied_status
                .map(|status| status_text(status).to_owned()),
            native_display_name: value.native_display_name.clone(),
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
    fn try_from(row: ApplicationRow) -> Result<Self> {
        Ok(Self {
            principal_id: row.principal_id,
            applied_revision: row.applied_revision,
            applied_intent_hash: row.applied_intent_hash,
            applied_status: row.applied_status.as_deref().map(status).transpose()?,
            native_display_name: row.native_display_name,
            last_attempt_at: row.last_attempt_at,
            last_success_at: row.last_success_at,
            next_check_at: row.next_check_at,
            error_code: row.error_code,
            error_message: row.error_message,
        })
    }
}

pub(crate) fn member_view(
    row: (PrincipalRow, MemberRow, RoleRow, ApplicationRow),
) -> Result<MemberView> {
    let (principal, member, assigned, application) = row;
    if kind(&member.principal_kind)? != PrincipalKind::Human {
        return Err(corrupt());
    }
    Ok(MemberView {
        principal: principal.try_into()?,
        member: Member {
            principal_id: member.principal_id,
            display_name: member.display_name,
        },
        role: PrincipalRole {
            principal_id: assigned.principal_id,
            principal_kind: kind(&assigned.principal_kind)?,
            role: role(&assigned.role_code)?,
            assigned_by_member_id: assigned.assigned_by_member_id,
            assigned_at: assigned.assigned_at,
        },
        application: application.try_into()?,
    })
}
