use crate::{
    agent::{replace_wake_policy, validate_wake_senders},
    coordination::{Policy, RequestedPolicy},
    identity::{Actor, PrincipalKind, Status},
    port::Audit,
    room_access::{
        authority::private_room,
        port::RoomRepository,
        service::apply_fleet_permissions,
        values::{Access, ApprovedPolicy},
    },
    wake::Sender,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

pub fn resolve(
    repo: &mut impl crate::port::AgentRepository,
    policy: &Policy,
    agent: Option<&str>,
    revision: Option<i64>,
) -> Result<RequestedPolicy> {
    let mut senders = policy
        .senders
        .iter()
        .map(|selected| {
            let sender = repo
                .principal_by_backend_user_id(&selected.backend_user_id)?
                .ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Invalid,
                        format!(
                            "Selected identity is not registered: {}",
                            selected.backend_user_id
                        ),
                    )
                })?;
            Ok(Sender {
                principal_id: sender.id,
                include_agents: selected.include_agents,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    validate_wake_senders(repo, agent, policy.mode, &senders)?;
    senders.sort_unstable_by(|left, right| left.principal_id.cmp(&right.principal_id));
    Ok(RequestedPolicy {
        mode: policy.mode,
        senders,
        invite_agents: policy.invite_agents,
        expected_agent_revision: revision,
    })
}
pub fn matches(
    repo: &mut impl RoomRepository,
    agent: &str,
    requested: &RequestedPolicy,
) -> Result<bool> {
    let current = repo.agent(agent)?;
    let policy = repo.approved_fleet_policy(agent)?;
    let senders = repo.wake_senders(agent)?;
    Ok(current.is_some_and(|current| {
        current.wake_mode == requested.mode
            && policy.is_some_and(|policy| {
                policy.approved_by_member_id == current.owner_id
                    && policy.invite_agents == requested.invite_agents
            })
            && senders.len() == requested.senders.len()
            && senders
                .iter()
                .all(|sender| requested.senders.contains(sender))
    }))
}
pub fn apply(
    repo: &mut impl RoomRepository,
    actor: &Actor,
    agent: &str,
    requested: &RequestedPolicy,
    request_id: &str,
    now: i64,
) -> Result<()> {
    let current = repo
        .agent_view(agent)?
        .filter(|current| {
            actor.kind == PrincipalKind::Human
                && current.agent.owner_id == actor.principal_id
                && current.principal.status == Status::Active
                && current.owner.status == Status::Active
        })
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Forbidden,
                "Only the active owner may approve fleet coordination",
            )
        })?;
    if requested
        .expected_agent_revision
        .is_some_and(|revision| revision != current.principal.revision)
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Agent configuration changed; submit a new fleet request",
        ));
    }
    if matches(repo, agent, requested)? {
        return Ok(());
    }
    replace_wake_policy(repo, &current.agent, requested.mode, &requested.senders)?;
    repo.approve_fleet_policy(&ApprovedPolicy {
        agent_id: agent.to_owned(),
        approved_by_member_id: actor.principal_id.clone(),
        approved_at: now,
        invite_agents: requested.invite_agents,
    })?;
    for mut grant in repo.room_grants(agent)? {
        if grant.intent.access == Access::None || private_room(repo, &grant.room_id)? {
            continue;
        }
        apply_fleet_permissions(repo, &grant, now)?;
        grant.revision = grant.revision.checked_add(1).ok_or_else(|| {
            Failure::new(ErrorCode::Conflict, "Room revision exceeds native range")
        })?;
        grant.updated_at = now;
        repo.save_room_grant(&grant, false)?;
    }
    let mut principal = current.principal;
    principal.revision = principal
        .revision
        .checked_add(1)
        .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Agent revision exceeds native range"))?;
    repo.save_principal(&principal)?;
    repo.audit(&Audit::new(
        actor,
        request_id,
        "agent",
        agent,
        "fleet.coordination-policy.approve",
        Some(&actor.principal_id),
        now,
    ))
}
