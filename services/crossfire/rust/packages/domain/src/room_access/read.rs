use super::{
    port::{RoomReadRepository, RoomRepository},
    values::*,
};
use crate::{
    authorization::{AgentAction, active_actor, authorize_agent},
    identity::{Actor, Page, PrincipalKind},
    matrix::{MatrixAuthority, RoomFacts, RoomPower},
    port::{AgentRepository, AuthorizationRepository, RepositoryAccess},
    read::values::Pagination,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::Clock};
use std::collections::BTreeMap;
pub struct GrantView {
    pub agent_id: String,
    pub revision: i64,
    pub owner_conversation: bool,
    pub grant: Option<Grant>,
    pub application: Option<Application>,
    pub permissions: Vec<&'static str>,
    pub allowed_actions: Vec<&'static str>,
}
pub struct RoomDetails {
    pub room_id: String,
    pub name: String,
    pub topic: String,
    pub alias: Option<String>,
    pub authority: Option<RoomFacts>,
}
pub fn grants(
    repo: &mut impl RoomReadRepository,
    actor: &Actor,
    agent: &str,
    pagination: Pagination,
    rooms: Option<&[String]>,
    now: i64,
) -> Result<Page<GrantView>> {
    authorize_agent(repo, actor, agent, AgentAction::Read, now)?;
    let target = repo
        .principal(agent)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
    let page = repo.grants_page(agent, pagination.validate()?, rooms)?;
    let rooms: Vec<_> = page
        .items
        .iter()
        .map(|grant| grant.room_id.clone())
        .collect();
    let mut applications: BTreeMap<_, _> = repo
        .applications_for_rooms(agent, &rooms)?
        .into_iter()
        .map(|application| (application.room_id.clone(), application))
        .collect();
    let permissions: BTreeMap<_, _> = repo
        .permissions_for_rooms(agent, &rooms)?
        .into_iter()
        .map(|permission| (permission.room_id.clone(), permission))
        .collect();
    let manageable = authorize_agent(repo, actor, agent, AgentAction::ManageRoomGrant, now).is_ok();
    let private = repo.owner_conversation(agent)?;
    let items = page
        .items
        .into_iter()
        .map(|grant| {
            let owner_conversation = private
                .as_ref()
                .is_some_and(|value| value.room_id == grant.room_id);
            let permission = permissions
                .get(&grant.room_id)
                .is_some_and(|permission| permission.generation == grant.generation);
            GrantView {
                agent_id: agent.to_owned(),
                revision: target.revision,
                owner_conversation,
                application: applications.remove(&grant.room_id),
                grant: Some(grant),
                permissions: if permission {
                    vec!["room.agent.invite"]
                } else {
                    Vec::new()
                },
                allowed_actions: if manageable && !owner_conversation {
                    vec!["set", "remove", "permissions.set"]
                } else {
                    Vec::new()
                },
            }
        })
        .collect();
    Ok(Page {
        items,
        page: page.page,
        page_size: page.page_size,
        total_items: page.total_items,
        total_pages: page.total_pages,
    })
}
pub async fn grant<A: RepositoryAccess, M: MatrixAuthority, C: Clock>(
    repository: &A,
    matrix: &M,
    clock: &C,
    actor: &Actor,
    agent: &str,
    room: &str,
) -> Result<GrantView>
where
    A::Repository: RoomRepository,
{
    let (acting, target, can_read, delegation) = repository.with(|repo| {
        let acting = active_actor(repo, actor, clock.now()?)?;
        let target = repo
            .agent_view(agent)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
        let can_read = authorize_agent(repo, actor, agent, AgentAction::Read, clock.now()?).is_ok();
        let delegated = if !can_read && actor.kind == PrincipalKind::Agent {
            let inviter = repo.room_grant(&actor.principal_id, room)?;
            let permission = repo.room_permission(&actor.principal_id, room)?;
            inviter.filter(|grant| {
                grant.intent.access != Access::None
                    && permission
                        .as_ref()
                        .is_some_and(|permission| permission.generation == grant.generation)
            })
        } else {
            None
        };
        Ok((acting, target, can_read, delegated))
    })?;
    let delegated = if delegation.is_some() {
        let facts = matrix.room(&acting.matrix_user_id, room).await?;
        matches!(facts.power, RoomPower::Creator)
            || matches!(facts.power,RoomPower::Level(level) if level>=facts.invite_level)
    } else {
        false
    };
    if !can_read && !delegated {
        return Err(Failure::new(ErrorCode::Missing, "Room grant not found"));
    }
    repository.with(|repo| {
        active_actor(repo, actor, clock.now()?)?;
        if let Some(prior) = &delegation {
            let current = repo.room_grant(&actor.principal_id, room)?;
            let permission = repo.room_permission(&actor.principal_id, room)?;
            if current.as_ref().is_none_or(|grant| {
                grant.generation != prior.generation
                    || grant.revision != prior.revision
                    || grant.intent.access == Access::None
            }) || permission.is_none_or(|permission| permission.generation != prior.generation)
            {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Room invitation authority changed",
                ));
            }
        }
        let grant = repo.room_grant(agent, room)?;
        let owner_conversation = repo
            .owner_conversation(agent)?
            .is_some_and(|value| value.room_id == room);
        let permission = repo
            .room_permission(agent, room)?
            .is_some_and(|permission| {
                grant
                    .as_ref()
                    .is_some_and(|grant| permission.generation == grant.generation)
            });
        let manage = authorize_agent(
            repo,
            actor,
            agent,
            AgentAction::ManageRoomGrant,
            clock.now()?,
        )
        .is_ok();
        let allowed_actions = if owner_conversation {
            Vec::new()
        } else if manage {
            vec!["set", "remove", "permissions.set"]
        } else if delegated
            && grant
                .as_ref()
                .is_none_or(|grant| grant.intent.access == Access::None)
        {
            vec!["set"]
        } else if delegated
            && grant
                .as_ref()
                .is_some_and(|grant| grant.added_by_id == actor.principal_id)
        {
            vec!["set", "remove"]
        } else {
            Vec::new()
        };
        Ok(GrantView {
            agent_id: agent.to_owned(),
            revision: target.principal.revision,
            owner_conversation,
            grant,
            application: repo.room_application(agent, room)?,
            permissions: if permission {
                vec!["room.agent.invite"]
            } else {
                Vec::new()
            },
            allowed_actions,
        })
    })
}
fn private_for(repo: &mut impl RoomRepository, room: &str, agent: &str) -> Result<bool> {
    Ok(repo.management_conversation_by_room(room)?.is_some()
        || repo
            .owner_conversation_by_room(room)?
            .is_some_and(|private| private.agent_id != agent))
}
pub async fn room<A: RepositoryAccess, M: MatrixAuthority, C: Clock>(
    repository: &A,
    matrix: &M,
    clock: &C,
    actor: &Actor,
    id: &str,
    agent: Option<&str>,
) -> Result<RoomDetails>
where
    A::Repository: RoomRepository,
{
    let acting = repository.with(|repo| {
        let acting = active_actor(repo, actor, clock.now()?)?;
        if let Some(agent) = agent {
            authorize_agent(repo, actor, agent, AgentAction::Read, clock.now()?)?;
            if private_for(repo, id, agent)? {
                return Err(Failure::new(
                    ErrorCode::Forbidden,
                    "This private owner DM is not an agent assignment",
                ));
            }
        }
        Ok(acting)
    })?;
    match matrix.room(&acting.matrix_user_id, id).await {
        Ok(facts) => Ok(RoomDetails {
            room_id: id.to_owned(),
            name: facts.name.clone(),
            topic: facts.topic.clone(),
            alias: facts.alias.clone(),
            authority: Some(facts),
        }),
        Err(error) => {
            let Some(agent) = agent else {
                return Err(error);
            };
            let target = repository.with(|repo| {
                authorize_agent(repo, actor, agent, AgentAction::Read, clock.now()?)?;
                if repo.room_grant(agent, id)?.is_none() {
                    return Err(Failure::new(ErrorCode::Missing, "Assigned room not found"));
                }
                repo.principal(agent)?
                    .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))
            })?;
            let observed = matrix.room(&target.matrix_user_id, id).await.ok();
            Ok(RoomDetails {
                room_id: id.to_owned(),
                name: observed
                    .as_ref()
                    .map_or_else(|| id.to_owned(), |facts| facts.name.clone()),
                topic: observed
                    .as_ref()
                    .map_or_else(String::new, |facts| facts.topic.clone()),
                alias: observed.and_then(|facts| facts.alias),
                authority: None,
            })
        }
    }
}
pub struct RoomQuery<'a> {
    pub actor: &'a Actor,
    pub agent: Option<&'a str>,
    pub search: &'a str,
    pub pagination: Pagination,
}
pub async fn rooms<A: RepositoryAccess, M: MatrixAuthority, C: Clock>(
    repository: &A,
    matrix: &M,
    clock: &C,
    input: RoomQuery<'_>,
    compare: impl Fn(&str, &str) -> std::cmp::Ordering,
) -> Result<Page<RoomDetails>>
where
    A::Repository: RoomRepository,
{
    let RoomQuery {
        actor,
        agent,
        search,
        pagination,
    } = input;
    pagination.validate()?;
    let acting = repository.with(|repo| active_actor(repo, actor, clock.now()?))?;
    let mut ids: std::collections::BTreeSet<_> = matrix
        .joined(&acting.matrix_user_id)
        .await?
        .into_iter()
        .collect();
    if let Some(agent) = agent {
        repository.with(|repo| {
            authorize_agent(repo, actor, agent, AgentAction::Read, clock.now()?)?;
            for grant in repo.room_grants(agent)? {
                ids.insert(grant.room_id);
            }
            Ok(())
        })?;
    }
    let mut result = Vec::new();
    let search = search.to_lowercase();
    for id in ids {
        if let Some(agent) = agent
            && repository.with(|repo| private_for(repo, &id, agent))?
        {
            continue;
        }
        let value = room(repository, matrix, clock, actor, &id, agent).await?;
        if [&value.name, value.alias.as_deref().unwrap_or(""), &id]
            .iter()
            .any(|text| text.to_lowercase().contains(&search))
        {
            result.push(value);
        }
    }
    result.sort_by(|first, second| {
        compare(&first.name, &second.name).then_with(|| compare(&first.room_id, &second.room_id))
    });
    let total = result.len() as i64;
    Ok(pagination.finish(
        result
            .into_iter()
            .skip(pagination.offset() as usize)
            .take(pagination.size as usize)
            .collect(),
        total,
    ))
}
