use crate::{
    authorization::{AgentAction, authorize_agent},
    identity::{Actor, Agent, AgentView, PrincipalKind, Status, WakeMode},
    port::{AgentRepository, Audit},
    wake::Sender,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::HashSet;

pub fn change(
    repo: &mut impl AgentRepository,
    actor: &Actor,
    id: &str,
    expected_revision: i64,
    status: Option<Status>,
    request_id: &str,
    now: i64,
) -> Result<AgentView> {
    repo.transaction(|repo| {
        let agent = authorize_agent(repo, actor, id, AgentAction::Configure, now)?;
        let mut view = repo
            .agent_view(id)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
        if view.principal.revision != expected_revision {
            return Err(Failure::new(ErrorCode::Conflict, "Agent revision changed"));
        }
        if view.principal.status == Status::Revoked {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Account revocation is permanent",
            ));
        }
        view.principal.status = status.unwrap_or(view.principal.status);
        view.principal.revision = expected_revision
            .checked_add(1)
            .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Agent revision exhausted"))?;
        view.application.next_check_at = now;
        repo.save_principal(&view.principal)?;
        repo.save_application(&view.application)?;
        repo.audit(&Audit::new(
            actor,
            request_id,
            "agent",
            id,
            "agent.configure",
            Some(&agent.owner_id),
            now,
        ))?;
        Ok(view)
    })
}

pub fn validate_wake_senders(
    repo: &mut impl AgentRepository,
    agent_id: Option<&str>,
    mode: WakeMode,
    senders: &[Sender],
) -> Result<()> {
    let mut ids = HashSet::with_capacity(senders.len());
    if senders.len() > 2000
        || mode == WakeMode::Everyone && !senders.is_empty()
        || senders.iter().any(|sender| {
            Some(sender.principal_id.as_str()) == agent_id
                || !ids.insert(sender.principal_id.as_str())
        })
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid selected sender list",
        ));
    }
    for selected in senders {
        let sender = repo
            .principal(&selected.principal_id)?
            .filter(|principal| principal.status == Status::Active)
            .ok_or_else(|| {
                Failure::new(ErrorCode::Invalid, "Select active registered identities")
            })?;
        if sender.kind == PrincipalKind::Agent {
            if selected.include_agents {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Only people can include their agents",
                ));
            }
            let agent = repo.agent_view(&selected.principal_id)?;
            let binding = repo.agent_binding(&selected.principal_id)?;
            if agent.is_none_or(|agent| agent.owner.status != Status::Active)
                || binding.is_none_or(|binding| {
                    binding.retired_at.is_some() || binding.fleet_archived_at.is_some()
                })
            {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Selected agent owner is not active",
                ));
            }
        }
    }
    Ok(())
}

pub fn replace_wake_policy(
    repo: &mut impl AgentRepository,
    agent: &Agent,
    mode: WakeMode,
    senders: &[Sender],
) -> Result<()> {
    validate_wake_senders(repo, Some(&agent.principal_id), mode, senders)?;
    repo.replace_wake_senders(&agent.principal_id, senders)?;
    repo.save_agent(&Agent {
        wake_mode: mode,
        ..agent.clone()
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WakePolicy {
    pub revision: i64,
    pub mode: WakeMode,
    pub senders: Vec<Sender>,
}

pub struct WakePolicyChange {
    pub expected_revision: i64,
    pub mode: WakeMode,
    pub senders: Vec<Sender>,
}

pub fn change_wake_policy(
    repo: &mut impl AgentRepository,
    actor: &Actor,
    id: &str,
    input: &WakePolicyChange,
    request_id: &str,
    now: i64,
) -> Result<WakePolicy> {
    repo.transaction(|repo| {
        let agent = authorize_agent(repo, actor, id, AgentAction::Configure, now)?;
        let mut principal = repo
            .principal(id)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
        if principal.revision != input.expected_revision {
            return Err(Failure::new(ErrorCode::Conflict, "Agent revision changed"));
        }
        if principal.status == Status::Revoked {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Account revocation is permanent",
            ));
        }
        replace_wake_policy(repo, &agent, input.mode, &input.senders)?;
        principal.revision = input
            .expected_revision
            .checked_add(1)
            .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Agent revision exhausted"))?;
        repo.save_principal(&principal)?;
        repo.audit(&Audit::new(
            actor,
            request_id,
            "agent",
            id,
            "agent.wake-policy.configure",
            Some(&agent.owner_id),
            now,
        ))?;
        let mut senders = input.senders.clone();
        senders.sort_by(|left, right| left.principal_id.cmp(&right.principal_id));
        Ok(WakePolicy {
            revision: principal.revision,
            mode: input.mode,
            senders,
        })
    })
}
