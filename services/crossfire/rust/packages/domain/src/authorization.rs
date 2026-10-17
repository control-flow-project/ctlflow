use crate::{
    identity::{Actor, Agent, Authentication, Principal, PrincipalKind, Status},
    permission::Permission,
    port::AuthorizationRepository,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

pub fn active_actor(
    repo: &mut impl AuthorizationRepository,
    actor: &Actor,
    now: i64,
) -> Result<Principal> {
    let principal = repo
        .principal(&actor.principal_id)?
        .filter(|value| value.kind == actor.kind && value.status == Status::Active)
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Forbidden,
                "An active registered identity is required",
            )
        })?;
    if let Some(Authentication::Native { matrix_user_id }) = &actor.authentication
        && matrix_user_id != &principal.matrix_user_id
    {
        return Err(Failure::new(
            ErrorCode::Unauthorized,
            "Native session identity changed",
        ));
    }
    if actor.kind == PrincipalKind::Human
        && !matches!(actor.authentication, Some(Authentication::Native { .. }))
    {
        let Some(Authentication::Management { session_hash }) = &actor.authentication else {
            return Err(Failure::new(
                ErrorCode::Unauthorized,
                "A verified human session is required",
            ));
        };
        repo.session(session_hash)?
            .filter(|session| session.member_id == actor.principal_id && session.expires_at > now)
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Unauthorized,
                    "Management session expired or ended",
                )
            })?;
    }
    if actor.kind == PrincipalKind::Agent {
        let agent = repo.agent(&actor.principal_id)?.ok_or_else(|| {
            Failure::new(ErrorCode::Forbidden, "Agent identity is not registered")
        })?;
        repo.principal(&agent.owner_id)?
            .filter(|owner| owner.status == Status::Active)
            .ok_or_else(|| Failure::new(ErrorCode::Forbidden, "Agent owner must be active"))?;
        let binding = repo
            .agent_binding(&actor.principal_id)?
            .filter(|value| value.retired_at.is_none())
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Forbidden,
                    "Agent requires a current approved fleet controller",
                )
            })?;
        if binding.fleet_archived_at.is_some() {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Agent fleet is archived",
            ));
        }
    }
    Ok(principal)
}

pub fn authorize(
    repo: &mut impl AuthorizationRepository,
    actor: &Actor,
    permission: Permission,
    now: i64,
) -> Result<Principal> {
    let principal = active_actor(repo, actor, now)?;
    if !repo.permissions(&actor.principal_id)?.contains(&permission) {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            format!("Permission required: {permission}"),
        ));
    }
    Ok(principal)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentAction {
    Read,
    Configure,
    ManageRoomGrant,
}

pub fn authorize_agent(
    repo: &mut impl AuthorizationRepository,
    actor: &Actor,
    agent_id: &str,
    action: AgentAction,
    now: i64,
) -> Result<Agent> {
    active_actor(repo, actor, now)?;
    let agent = repo
        .agent(agent_id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
    let binding = repo
        .agent_binding(agent_id)?
        .filter(|value| value.retired_at.is_none() && value.fleet_archived_at.is_none())
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Current fleet-managed agent not found"))?;
    let (any, owned) = match action {
        AgentAction::Read => (Permission::AgentReadAny, Permission::AgentReadOwned),
        AgentAction::Configure => (
            Permission::AgentConfigureAny,
            Permission::AgentConfigureOwned,
        ),
        AgentAction::ManageRoomGrant => (
            Permission::AgentRoomGrantManageAny,
            Permission::AgentRoomGrantManageOwned,
        ),
    };
    let permissions = repo.permissions(&actor.principal_id)?;
    let allowed = permissions.contains(&any)
        || agent.owner_id == actor.principal_id && permissions.contains(&owned)
        || action == AgentAction::Read
            && binding.agent_id == actor.principal_id
            && permissions.contains(&Permission::AgentReadSelf);
    if allowed {
        Ok(agent)
    } else {
        Err(Failure::new(ErrorCode::Missing, "Agent not found"))
    }
}
