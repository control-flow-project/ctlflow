use crate::{
    authorization::{active_actor, authorize},
    identity::{Actor, Authentication, MemberView, Page, PrincipalKind, Role, Status},
    permission::Permission,
    port::{Audit, CoreRepository},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
pub mod invitation;
pub mod signup;

#[derive(Debug, Clone)]
pub struct Change {
    pub expected_revision: i64,
    pub status: Option<Status>,
    pub display_name: Option<String>,
    pub role: Option<Role>,
}

pub fn read(
    repo: &mut impl CoreRepository,
    actor: &Actor,
    member_id: &str,
    now: i64,
) -> Result<MemberView> {
    authorize(repo, actor, Permission::MemberManage, now)?;
    repo.member_view(member_id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Member not found"))
}

pub fn list(
    repo: &mut impl CoreRepository,
    actor: &Actor,
    page: i64,
    page_size: i64,
    now: i64,
) -> Result<Page<MemberView>> {
    authorize(repo, actor, Permission::MemberManage, now)?;
    repo.members_page(page, page_size)
}

pub fn change(
    repo: &mut impl CoreRepository,
    actor: &Actor,
    member_id: &str,
    input: &Change,
    request_id: &str,
    now: i64,
) -> Result<MemberView> {
    if let Some(name) = &input.display_name
        && (name.is_empty()
            || name.encode_utf16().count() > 100
            || name
                .chars()
                .any(|value| value <= '\u{1f}' || value == '\u{7f}'))
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Member names must contain 1–100 characters without control characters",
        ));
    }
    if input.role == Some(Role::Agent) {
        return Err(Failure::new(ErrorCode::Invalid, "A human role is required"));
    }
    repo.transaction(|repo| {
        let self_name = actor.kind == PrincipalKind::Human
            && matches!(actor.authentication, Some(Authentication::Native { .. }))
            && actor.principal_id == member_id
            && input.display_name.is_some()
            && input.status.is_none()
            && input.role.is_none();
        if self_name {
            active_actor(repo, actor, now)?;
        } else {
            authorize(repo, actor, Permission::MemberManage, now)?;
        }
        let mut current = repo
            .member_view(member_id)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Member not found"))?;
        if current.principal.status == Status::Revoked {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Account revocation is permanent",
            ));
        }
        if current.principal.revision != input.expected_revision {
            return Err(Failure::new(ErrorCode::Conflict, "Member revision changed"));
        }
        let status = input.status.unwrap_or(current.principal.status);
        let role = input.role.unwrap_or(current.role.role);
        if current.role.role == Role::Administrator
            && current.principal.status == Status::Active
            && (role != Role::Administrator || status != Status::Active)
            && repo.active_administrator_count()? <= 1
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "At least one active administrator is required",
            ));
        }
        current.principal.status = status;
        current.principal.revision = input
            .expected_revision
            .checked_add(1)
            .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Member revision exhausted"))?;
        repo.save_principal(&current.principal)?;
        if !self_name {
            current.role.role = role;
            current.role.assigned_by_member_id = Some(actor.principal_id.clone());
            current.role.assigned_at = now;
            repo.save_role(&current.role)?;
        }
        if let Some(name) = &input.display_name {
            current.member.display_name = name.clone();
        }
        repo.save_member(&current.member)?;
        current.application.next_check_at = now;
        repo.save_application(&current.application)?;
        repo.schedule_owned_agents(member_id, status == Status::Revoked, now)?;
        repo.audit(&Audit::new(
            actor,
            request_id,
            "member",
            member_id,
            "member.configure",
            Some(member_id),
            now,
        ))?;
        Ok(current)
    })
}
