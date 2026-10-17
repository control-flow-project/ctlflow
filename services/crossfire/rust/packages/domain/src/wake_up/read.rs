use super::{
    authority::authorized_rule,
    values::{Details, ListFilter, Rule, RuleRepository, Summary},
};
use crate::{
    authorization::active_actor,
    identity::{Actor, Page, PrincipalKind},
    permission::Permission,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::{BTreeMap, BTreeSet};

fn summarize(repo: &mut impl RuleRepository, rules: Vec<Rule>) -> Result<Vec<Summary>> {
    let ids: Vec<_> = rules.iter().map(|value| value.id.clone()).collect();
    let owners: Vec<_> = rules
        .iter()
        .map(|value| value.owner_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let owners: BTreeMap<_, _> = repo
        .selected_principals(&owners)?
        .into_iter()
        .map(|value| (value.principal_id.clone(), value))
        .collect();
    let assignments = repo.wake_assignments(&ids)?;
    let mut by_rule = BTreeMap::<String, Vec<_>>::new();
    for value in assignments {
        by_rule
            .entry(value.rule_id.clone())
            .or_default()
            .push(value);
    }
    rules
        .into_iter()
        .map(|rule| {
            let owner = owners
                .get(&rule.owner_id)
                .cloned()
                .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Wake-up owner is missing"))?;
            let assigned = by_rule.remove(&rule.id).unwrap_or_default();
            Ok(Summary {
                owner,
                agent_count: assigned.len(),
                next_due_at: rule
                    .enabled
                    .then(|| assigned.iter().map(|value| value.next_due_at).min())
                    .flatten(),
                last_delivered_at: assigned
                    .iter()
                    .filter_map(|value| value.last_delivered_at)
                    .max(),
                rule,
            })
        })
        .collect()
}

pub fn read(repo: &mut impl RuleRepository, actor: &Actor, id: &str, now: i64) -> Result<Details> {
    let rule = authorized_rule(repo, actor, id, false, now)?;
    let summary = summarize(repo, vec![rule])?
        .into_iter()
        .next()
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Wake-up summary is missing"))?;
    let assignments = repo.wake_assignments(&[id.to_owned()])?;
    let ids: Vec<_> = assignments
        .iter()
        .map(|value| value.agent_id.clone())
        .collect();
    let agents: BTreeMap<_, _> = repo
        .selected_principals(&ids)?
        .into_iter()
        .map(|value| (value.principal_id.clone(), value))
        .collect();
    Ok(Details {
        summary,
        agents: assignments
            .into_iter()
            .map(|value| {
                agents
                    .get(&value.agent_id)
                    .cloned()
                    .map(|agent| (agent, value))
                    .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Wake-up agent is missing"))
            })
            .collect::<Result<_>>()?,
    })
}

pub fn list(
    repo: &mut impl RuleRepository,
    actor: &Actor,
    filter: &ListFilter<'_>,
    now: i64,
) -> Result<Page<Summary>> {
    let ListFilter {
        owner_id: requested_owner,
        search,
        page,
        page_size: size,
    } = *filter;
    if actor.kind != PrincipalKind::Human {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Only members can list Wake-ups",
        ));
    }
    active_actor(repo, actor, now)?;
    let permissions = repo.permissions(&actor.principal_id)?;
    let owner = if permissions.contains(&Permission::WakeRuleReadAny) {
        requested_owner
    } else if permissions.contains(&Permission::WakeRuleReadOwned)
        && requested_owner.is_none_or(|id| id == actor.principal_id)
    {
        Some(actor.principal_id.as_str())
    } else {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "This owner scope is not permitted",
        ));
    };
    let current = repo.wake_rules_page(owner, search, page, size)?;
    Ok(Page {
        items: summarize(repo, current.items)?,
        page: current.page,
        page_size: current.page_size,
        total_items: current.total_items,
        total_pages: current.total_pages,
    })
}
