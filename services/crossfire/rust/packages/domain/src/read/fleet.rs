use super::{access::owner_scope, agent, port::ReadRepository, values::*};
use crate::{
    fleet::{
        authority::authorize_fleet,
        control::connection_view,
        native_stop::{self, Selection},
        values::{Fleet, FleetActor},
    },
    identity::{Actor, Page, PrincipalKind, Status},
    permission::Permission,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::{BTreeMap, BTreeSet};
fn details(
    repo: &mut impl ReadRepository,
    actor: &FleetActor,
    fleets: Vec<Fleet>,
    now: i64,
) -> Result<Vec<FleetDetails>> {
    let ids: Vec<_> = fleets.iter().map(|fleet| fleet.id.clone()).collect();
    let owners: BTreeSet<_> = fleets.iter().map(|fleet| fleet.owner_id.clone()).collect();
    let owners: BTreeMap<_, _> = repo
        .selected_principals(&owners.into_iter().collect::<Vec<_>>())?
        .into_iter()
        .map(|owner| (owner.principal_id.clone(), owner))
        .collect();
    let mut metadata = repo.fleet_metadata_many(&ids)?;
    let mut connections = repo.fleet_connections(&ids)?;
    let eligibility = native_stop::eligibility(repo, Selection::Fleets(&ids), now)?;
    fleets.into_iter().map(|fleet| {
        let connection = connections.remove(&fleet.id);
        let writable = match authorize_fleet(repo, actor, &fleet, true, now) {
            Ok(()) => true,
            Err(error) if error.code == ErrorCode::Forbidden => false,
            Err(error) => return Err(error),
        };
        let can_archive = writable && !matches!(actor, FleetActor::Principal(actor) if actor.kind == PrincipalKind::Agent)
            && match actor { FleetActor::Controller { credential_id, .. } => connection.as_ref().is_some_and(|value| value.credential_id == *credential_id && value.closed_at.is_none() && value.expires_at > now), _ => true }
            && eligibility.fleets.get(&fleet.id) == Some(&true);
        let mut allowed_actions = Vec::new();
        if writable { allowed_actions.push("configure"); }
        if can_archive { allowed_actions.push("archive"); }
        let owner = owners.get(&fleet.owner_id).cloned().ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Fleet owner record is missing"))?;
        Ok(FleetDetails { metadata: metadata.remove(&fleet.id).unwrap_or_default(), owner, connection: connection_view(connection.as_ref(), now), fleet, can_archive, allowed_actions })
    }).collect()
}
pub fn read(
    repo: &mut impl ReadRepository,
    actor: &FleetActor,
    id: &str,
    now: i64,
) -> Result<FleetDetails> {
    let fleet = repo
        .fleet(id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Fleet not found"))?;
    authorize_fleet(repo, actor, &fleet, false, now)?;
    details(repo, actor, vec![fleet], now)?
        .pop()
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Fleet not found"))
}
pub fn list(
    repo: &mut impl ReadRepository,
    actor: &Actor,
    owner: Option<&str>,
    search: &str,
    pagination: Pagination,
    now: i64,
) -> Result<Page<FleetDetails>> {
    let owner = owner_scope(
        repo,
        actor,
        Permission::AgentReadAny,
        Permission::AgentReadOwned,
        owner,
        now,
    )?;
    let page = repo.fleets_page(owner.as_deref(), search, pagination.validate()?)?;
    Ok(Page {
        items: details(repo, &FleetActor::Principal(actor.clone()), page.items, now)?,
        page: page.page,
        page_size: page.page_size,
        total_items: page.total_items,
        total_pages: page.total_pages,
    })
}
pub fn agents(
    repo: &mut impl ReadRepository,
    actor: &FleetActor,
    id: &str,
    pagination: Pagination,
    now: i64,
) -> Result<Page<(String, AgentDetails)>> {
    let fleet = read(repo, actor, id, now)?;
    let instances = repo.current_fleet_instances(&fleet.fleet)?;
    let ids: Vec<_> = instances
        .iter()
        .map(|instance| instance.agent_id.clone())
        .collect();
    let mut keys: BTreeMap<_, _> = instances
        .into_iter()
        .map(|instance| (instance.agent_id, instance.instance_key))
        .collect();
    let page = repo.agents_page(
        &AgentFilter {
            pagination: pagination.validate()?,
            owner_id: Some(&fleet.fleet.owner_id),
            search: "",
            statuses: &[Status::Active, Status::Suspended, Status::Revoked],
            listener: None,
            agent_ids: Some(&ids),
        },
        None,
    )?;
    let principal = match actor {
        FleetActor::Principal(actor) => Some(actor),
        _ => None,
    };
    let items = agent::details(repo, principal, page.items, now)?
        .into_iter()
        .map(|agent| {
            let key = keys
                .remove(&agent.record.view.principal.id)
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Unavailable, "Current fleet instance is missing")
                })?;
            Ok((key, agent))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Page {
        items,
        page: page.page,
        page_size: page.page_size,
        total_items: page.total_items,
        total_pages: page.total_pages,
    })
}
