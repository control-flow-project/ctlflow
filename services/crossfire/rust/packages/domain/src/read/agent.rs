use super::{access::owner_scope, port::ReadRepository, values::*};
use crate::{
    authorization::{AgentAction, authorize_agent},
    fleet::native_stop::{self, Selection},
    identity::{Actor, Page},
    listener::{HEARTBEAT_EXPIRY_MS, admits_controller},
    permission::Permission,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::BTreeMap;
pub fn activity(
    repo: &mut impl ReadRepository,
    ids: &[String],
    now: i64,
) -> Result<BTreeMap<String, Activity>> {
    let mut totals: BTreeMap<_, _> = repo
        .listener_totals(ids)?
        .into_iter()
        .map(|total| (total.agent_id.clone(), total))
        .collect();
    let mut runs: BTreeMap<String, Vec<crate::listener::Run>> = BTreeMap::new();
    for candidate in
        repo.admission_candidates(Some(ids), now.saturating_sub(HEARTBEAT_EXPIRY_MS))?
    {
        if admits_controller(
            candidate.run.controller.as_ref(),
            candidate.facts.as_ref(),
            now,
        ) {
            runs.entry(candidate.run.agent_id.clone())
                .or_default()
                .push(candidate.run);
        }
    }
    Ok(ids
        .iter()
        .map(|id| {
            let total = totals.remove(id);
            let active_runs = runs.remove(id).unwrap_or_default();
            let status = if active_runs
                .iter()
                .any(|run| run.disconnect_requested_at.is_none())
            {
                ActivityState::Online
            } else if active_runs.is_empty() {
                ActivityState::Offline
            } else {
                ActivityState::Disconnecting
            };
            (
                id.clone(),
                Activity {
                    status,
                    active_ms: total.as_ref().map_or(0, |total| total.active_ms),
                    messages_delivered: total.as_ref().map_or(0, |total| total.messages_delivered),
                    last_seen_at: total.map(|total| total.last_seen_at),
                    active_runs,
                },
            )
        })
        .collect())
}
pub fn details(
    repo: &mut impl ReadRepository,
    actor: Option<&Actor>,
    records: Vec<AgentRecord>,
    now: i64,
) -> Result<Vec<AgentDetails>> {
    let ids: Vec<_> = records
        .iter()
        .map(|record| record.view.principal.id.clone())
        .collect();
    let mut activity = activity(repo, &ids, now)?;
    let mut deployments = repo.deployments(&ids)?;
    let mut native = repo.native_summaries(&ids)?;
    let eligibility = native_stop::eligibility(repo, Selection::Agents(&ids), now)?;
    let permissions = actor
        .map(|actor| repo.permissions(&actor.principal_id))
        .transpose()?
        .unwrap_or_default();
    records
        .into_iter()
        .map(|record| {
            let id = &record.view.principal.id;
            let deployment = deployments.remove(id).ok_or_else(|| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Current agent fleet binding is missing",
                )
            })?;
            let can_retire = eligibility
                .agents
                .get(id)
                .is_some_and(|(fleet, eligible)| fleet == &deployment.fleet_id && *eligible);
            let owned = actor.is_some_and(|actor| actor.principal_id == record.view.agent.owner_id);
            let mut allowed_actions = Vec::new();
            if permissions.contains(&Permission::AgentConfigureAny)
                || owned && permissions.contains(&Permission::AgentConfigureOwned)
            {
                allowed_actions.push("configure");
            }
            if permissions.contains(&Permission::AgentRoomGrantManageAny)
                || owned && permissions.contains(&Permission::AgentRoomGrantManageOwned)
            {
                allowed_actions.push("room-grant.manage");
            }
            if can_retire && allowed_actions.contains(&"configure") {
                allowed_actions.push("retire");
            }
            let activity = activity
                .remove(id)
                .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Agent activity is missing"))?;
            Ok(AgentDetails {
                native_runtime: native.remove(id),
                record,
                deployment,
                can_retire,
                allowed_actions,
                activity,
            })
        })
        .collect()
}
pub fn read(
    repo: &mut impl ReadRepository,
    actor: &Actor,
    id: &str,
    now: i64,
) -> Result<AgentDetails> {
    authorize_agent(repo, actor, id, AgentAction::Read, now)?;
    let view = repo
        .agent_view(id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
    let name = repo
        .agent_name(id)?
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Agent name is missing"))?;
    details(repo, Some(actor), vec![AgentRecord { name, view }], now)?
        .pop()
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))
}
pub fn list(
    repo: &mut impl ReadRepository,
    actor: &Actor,
    filter: &AgentFilter<'_>,
    now: i64,
) -> Result<Page<AgentDetails>> {
    filter.pagination.validate()?;
    let owner = owner_scope(
        repo,
        actor,
        Permission::AgentReadAny,
        Permission::AgentReadOwned,
        filter.owner_id,
        now,
    )?;
    let activity = match filter.listener {
        None => None,
        Some(mode) => {
            let mut candidates =
                repo.admission_candidates(None, now.saturating_sub(HEARTBEAT_EXPIRY_MS))?;
            candidates.retain(|candidate| {
                admits_controller(
                    candidate.run.controller.as_ref(),
                    candidate.facts.as_ref(),
                    now,
                )
            });
            let reporting: std::collections::BTreeSet<_> = candidates
                .iter()
                .map(|candidate| candidate.run.agent_id.clone())
                .collect();
            let online: std::collections::BTreeSet<_> = candidates
                .iter()
                .filter(|candidate| candidate.run.disconnect_requested_at.is_none())
                .map(|candidate| candidate.run.agent_id.clone())
                .collect();
            Some((
                match mode {
                    ActivityState::Online => online.into_iter().collect::<Vec<_>>(),
                    ActivityState::Offline => reporting.into_iter().collect(),
                    ActivityState::Disconnecting => {
                        reporting.difference(&online).cloned().collect()
                    }
                },
                mode != ActivityState::Offline,
            ))
        }
    };
    let page = repo.agents_page(
        &AgentFilter {
            owner_id: owner.as_deref(),
            ..*filter
        },
        activity
            .as_ref()
            .map(|(ids, include)| (ids.as_slice(), *include)),
    )?;
    Ok(Page {
        items: details(repo, Some(actor), page.items, now)?,
        page: page.page,
        page_size: page.page_size,
        total_items: page.total_items,
        total_pages: page.total_pages,
    })
}
pub fn history(
    repo: &mut impl ReadRepository,
    actor: &Actor,
    id: &str,
    pagination: Pagination,
    now: i64,
) -> Result<Page<crate::listener::Run>> {
    authorize_agent(repo, actor, id, AgentAction::Read, now)?;
    repo.listener_history(id, pagination.validate()?)
}
