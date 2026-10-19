use super::{
    port::RoomRepository,
    values::{Access, Grant},
};
use crate::{
    authorization::{AgentAction, authorize_agent},
    identity::{Actor, AgentView},
    messaging::Membership,
    port::DiscoveryRepository,
    wake,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
pub struct Policy {
    pub agent: AgentView,
    pub grants: Vec<Grant>,
    pub wake_senders: Vec<String>,
    pub max_message_bytes: i64,
    pub idle_timeout_seconds: i64,
    pub owner_conversation: Option<String>,
}
pub fn read(
    repo: &mut (impl RoomRepository + DiscoveryRepository),
    actor: &Actor,
    agent: &str,
    now: i64,
) -> Result<Policy> {
    authorize_agent(repo, actor, agent, AgentAction::Read, now)?;
    let agent = repo
        .agent_view(agent)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
    let policy = repo.policy()?.ok_or_else(|| {
        Failure::new(
            ErrorCode::Unavailable,
            "Instance delivery policy is not initialized",
        )
    })?;
    let mut eligible = Vec::new();
    for grant in repo.room_grants(&agent.principal.id)? {
        if grant.intent.access == Access::None {
            continue;
        }
        if repo
            .room_application(&agent.principal.id, &grant.room_id)?
            .is_some_and(|application| {
                application.membership == Some(Membership::Join)
                    && application.error_code.is_none()
                    && application.observed_generation.as_ref() == Some(&grant.generation)
            })
        {
            eligible.push(grant);
        }
    }
    let conversation = repo.owner_conversation(&agent.principal.id)?;
    if let Some(conversation) = &conversation
        && agent.principal.status == crate::identity::Status::Active
        && agent.owner.status == crate::identity::Status::Active
        && !eligible.iter().any(|grant| {
            grant.room_id == conversation.room_id
                && grant.intent.access == Access::Reply
                && !grant.intent.muted
        })
    {
        return Err(Failure::new(
            ErrorCode::Unavailable,
            "The established private owner conversation is not ready",
        ));
    }
    let owner_conversation = conversation
        .filter(|conversation| {
            eligible
                .iter()
                .any(|grant| grant.room_id == conversation.room_id)
        })
        .map(|conversation| conversation.room_id);
    let wake_senders = wake::resolve(repo, &agent.agent)?;
    Ok(Policy {
        agent,
        grants: eligible,
        wake_senders,
        max_message_bytes: policy.max_message_bytes,
        idle_timeout_seconds: policy.fleet_idle_timeout_seconds,
        owner_conversation,
    })
}
