use super::{
    authority,
    port::RoomRepository,
    read,
    service::{self, Service},
    values::*,
};
use crate::{
    authorization::{AgentAction, authorize_agent},
    fleet::{authority::authorize_fleet, values::FleetActor},
    identity::{Actor, PrincipalKind},
    messaging::MessagingAuthority,
    port::{
        AgentRepository, AuthorizationRepository, CoreRepository, FleetRepository,
        RepositoryAccess, UnitOfWork,
    },
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::Clock};
use std::collections::BTreeSet;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposedGrant {
    pub room_id: String,
    pub intent: Intent,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProposedAgent {
    pub instance_key: String,
    pub grants: Vec<ProposedGrant>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    pub fleet_id: String,
    pub agents: Vec<ProposedAgent>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantSnapshot {
    pub room_id: String,
    pub generation: String,
    pub revision: i64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Snapshot {
    pub agent_id: String,
    pub revision: i64,
    pub grants: Vec<GrantSnapshot>,
}
pub struct NamedChange {
    pub authorization: Authorization,
    pub agent_name: String,
    pub instance_key: String,
    pub room_name: String,
    pub room_alias: Option<String>,
}
pub struct Preview {
    pub digest: String,
    pub fleet_id: String,
    pub fleet_revision: i64,
    pub snapshots: Vec<Snapshot>,
    pub changes: Vec<NamedChange>,
}
pub trait PlanEncoding {
    fn compare(&self, first: &str, second: &str) -> std::cmp::Ordering;
    fn digest(&self, preview: &Preview) -> Result<String>;
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub async fn preview<A: RepositoryAccess, M: MessagingAuthority, C: Clock>(
    service: &Service<'_, A, M, C>,
    encoding: &impl PlanEncoding,
    actor: &Actor,
    plan: &Plan,
) -> Result<Preview>
where
    A::Repository: RoomRepository + FleetRepository,
{
    if actor.kind != PrincipalKind::Human {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Only a human can review a fleet room plan",
        ));
    }
    if plan.agents.is_empty()
        || plan.agents.len() > 100
        || plan
            .agents
            .iter()
            .map(|agent| &agent.instance_key)
            .collect::<BTreeSet<_>>()
            .len()
            != plan.agents.len()
    {
        return Err(invalid("Choose 1–100 unique fleet instances"));
    }
    let fleet = service.repository.with(|repo| {
        let fleet = repo
            .fleet(&plan.fleet_id)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Fleet not found"))?;
        authorize_fleet(
            repo,
            &FleetActor::Principal(actor.clone()),
            &fleet,
            true,
            service.clock.now()?,
        )?;
        Ok(fleet)
    })?;
    let mut selected: Vec<_> = plan.agents.iter().collect();
    selected.sort_by(|first, second| encoding.compare(&first.instance_key, &second.instance_key));
    let mut snapshots = Vec::new();
    let mut changes = Vec::new();
    for selected in selected {
        if selected.grants.len() > 100
            || selected
                .grants
                .iter()
                .map(|grant| &grant.room_id)
                .collect::<BTreeSet<_>>()
                .len()
                != selected.grants.len()
            || selected
                .grants
                .iter()
                .any(|grant| grant.intent.access == Access::None)
        {
            return Err(invalid(
                "A room plan lists up to 100 unique active grants per agent",
            ));
        }
        let (target, name, current, conversation) = service.repository.with(|repo| {
            let binding = repo
                .fleet_instance(&fleet.owner_id, &fleet.fleet_key, &selected.instance_key)?
                .filter(|binding| binding.retired_at.is_none())
                .ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Missing,
                        format!(
                            "Fleet instance is not registered: {}",
                            selected.instance_key
                        ),
                    )
                })?;
            authorize_agent(
                repo,
                actor,
                &binding.agent_id,
                AgentAction::ManageRoomGrant,
                service.clock.now()?,
            )?;
            let target = repo
                .principal(&binding.agent_id)?
                .ok_or_else(|| Failure::new(ErrorCode::Missing, "Target agent not found"))?;
            let name = repo
                .agent_name(&binding.agent_id)?
                .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Agent name is missing"))?;
            let current = repo.room_grants(&binding.agent_id)?;
            let conversation = repo.owner_conversation(&binding.agent_id)?;
            Ok((target, name, current, conversation))
        })?;
        if selected.grants.iter().any(|grant| {
            conversation
                .as_ref()
                .is_some_and(|private| grant.room_id == private.room_id)
        }) {
            return Err(invalid(
                "Owner DMs are built in and must not appear in a room plan",
            ));
        }
        let mut snapshot = Snapshot {
            agent_id: target.id.clone(),
            revision: target.revision,
            grants: current
                .iter()
                .map(|grant| GrantSnapshot {
                    room_id: grant.room_id.clone(),
                    generation: grant.generation.clone(),
                    revision: grant.revision,
                })
                .collect(),
        };
        snapshot
            .grants
            .sort_by(|first, second| encoding.compare(&first.room_id, &second.room_id));
        snapshots.push(snapshot);
        let rooms: BTreeSet<_> = current
            .iter()
            .filter(|grant| {
                conversation
                    .as_ref()
                    .is_none_or(|private| private.room_id != grant.room_id)
            })
            .map(|grant| grant.room_id.clone())
            .chain(selected.grants.iter().map(|grant| grant.room_id.clone()))
            .collect();
        let mut rooms: Vec<_> = rooms.into_iter().collect();
        rooms.sort_by(|first, second| first.encode_utf16().cmp(second.encode_utf16()));
        for room in rooms {
            let previous = current.iter().find(|grant| grant.room_id == room);
            let next = selected
                .grants
                .iter()
                .find(|grant| grant.room_id == room)
                .map_or(
                    Intent {
                        access: Access::None,
                        native_access: None,
                        muted: false,
                    },
                    |grant| grant.intent.clone(),
                );
            let authorization = service
                .authorize(
                    actor,
                    &Change {
                        agent_id: target.id.clone(),
                        room_id: room.clone(),
                        expected_revision: target.revision,
                        expected_generation: previous.map(|grant| grant.generation.clone()),
                        intent: next,
                    },
                    None,
                )
                .await?;
            let (room_name, room_alias) = if let Some(facts) = &authorization.native {
                (facts.name.clone(), facts.alias.clone())
            } else {
                read::room(
                    service.repository,
                    service.messaging,
                    service.clock,
                    actor,
                    &room,
                    Some(&target.id),
                )
                .await
                .map_or((room.clone(), None), |facts| (facts.name, facts.alias))
            };
            changes.push(NamedChange {
                authorization,
                agent_name: name.clone(),
                instance_key: selected.instance_key.clone(),
                room_name,
                room_alias,
            });
        }
    }
    service.repository.with(|repo| {
        if repo
            .fleet(&plan.fleet_id)?
            .is_none_or(|current| current.revision != fleet.revision)
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Fleet changed during review",
            ));
        }
        Ok(())
    })?;
    let mut result = Preview {
        digest: String::new(),
        fleet_id: fleet.id,
        fleet_revision: fleet.revision,
        snapshots,
        changes,
    };
    result.digest = encoding.digest(&result)?;
    Ok(result)
}
pub async fn apply<A: RepositoryAccess, M: MessagingAuthority, C: Clock>(
    service: &Service<'_, A, M, C>,
    encoding: &impl PlanEncoding,
    actor: &Actor,
    plan: &Plan,
    digest: &str,
    snapshots: &[Snapshot],
    request: &str,
) -> Result<Vec<String>>
where
    A::Repository: RoomRepository + FleetRepository,
{
    let preview = preview(service, encoding, actor, plan).await?;
    if preview.digest != digest || preview.snapshots != snapshots {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Room plan, native authority or revisions changed; review a new preview",
        ));
    }
    service.repository.with(|repo| {
        repo.transaction(|repo| {
            let now = service.clock.now()?;
            let fleet = repo
                .fleet(&preview.fleet_id)?
                .filter(|fleet| fleet.revision == preview.fleet_revision)
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Conflict, "Fleet changed; review a new preview")
                })?;
            authorize_fleet(
                repo,
                &FleetActor::Principal(actor.clone()),
                &fleet,
                true,
                now,
            )?;
            for change in &preview.changes {
                authority::recheck(repo, actor, &change.authorization, now)?;
            }
            for change in &preview.changes {
                service::commit(repo, actor, &change.authorization, request, false, now)?;
            }
            for snapshot in &preview.snapshots {
                if !preview.changes.iter().any(|change| {
                    change.authorization.input.agent_id == snapshot.agent_id
                        && change.authorization.changed
                }) {
                    continue;
                }
                let mut principal = repo
                    .principal(&snapshot.agent_id)?
                    .filter(|principal| principal.revision == snapshot.revision)
                    .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Agent revision changed"))?;
                principal.revision = principal
                    .revision
                    .checked_add(1)
                    .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Agent revision exhausted"))?;
                repo.save_principal(&principal)?;
            }
            Ok(preview
                .snapshots
                .into_iter()
                .map(|snapshot| snapshot.agent_id)
                .collect())
        })
    })
}
