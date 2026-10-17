use super::{
    authority::authorized_rule,
    read,
    values::{Assignment, Change, Details, Input, Rule, RuleRepository},
};
use crate::{
    authorization::{AgentAction, authorize, authorize_agent},
    identity::{Actor, PrincipalKind, Status},
    permission::Permission,
    port::Audit,
    schedule::ScheduleCalculator,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, text::whitespace};
use std::collections::{BTreeMap, BTreeSet};

fn validate(
    repo: &mut impl RuleRepository,
    schedule: &impl ScheduleCalculator,
    actor: &Actor,
    input: &Input,
    now: i64,
) -> Result<i64> {
    if input.name.trim_matches(whitespace).is_empty() || input.name.encode_utf16().count() > 100
        || input.name.chars().any(|value| value <= '\u{1f}' || value == '\u{7f}')
        || input.message.trim_matches(whitespace).is_empty() || input.message.len() > 16_384
        || input.message.chars().any(|value| matches!(value, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}')) {
        return Err(Failure::new(ErrorCode::Invalid, "Provide a name and a plain-text wake-up message of at most 16 KiB"));
    }
    if input.agent_ids.len() > 1000
        || input.agent_ids.iter().collect::<BTreeSet<_>>().len() != input.agent_ids.len()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Select at most 1000 distinct agents",
        ));
    }
    let next = schedule.next(&input.schedule, now)?;
    for id in &input.agent_ids {
        let agent = authorize_agent(repo, actor, id, AgentAction::Configure, now)?;
        if repo
            .principal(id)?
            .is_none_or(|value| value.status != Status::Active)
            || repo
                .principal(&agent.owner_id)?
                .is_none_or(|value| value.status != Status::Active)
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Only active agents with active owners can be attached",
            ));
        }
    }
    Ok(next)
}

fn assign(repo: &mut impl RuleRepository, id: &str, selected: &[String], next: i64) -> Result<()> {
    let before: BTreeMap<_, _> = repo
        .wake_assignments(&[id.to_owned()])?
        .into_iter()
        .map(|value| (value.agent_id.clone(), value))
        .collect();
    let selected_ids: BTreeSet<_> = selected.iter().collect();
    for previous in before.values() {
        if !selected_ids.contains(&previous.agent_id) {
            repo.remove_wake_assignment(id, &previous.agent_id)?;
        }
    }
    for agent_id in selected {
        repo.save_wake_assignment(&Assignment {
            rule_id: id.to_owned(),
            agent_id: agent_id.clone(),
            next_due_at: next,
            last_delivered_at: before
                .get(agent_id)
                .and_then(|value| value.last_delivered_at),
        })?;
    }
    Ok(())
}

pub fn save(
    repo: &mut impl RuleRepository,
    schedule: &impl ScheduleCalculator,
    actor: &Actor,
    change: &Change<'_>,
) -> Result<Details> {
    let Change {
        rule_id: id,
        input,
        expected_revision,
        request_id,
        now,
    } = *change;
    repo.transaction(|repo| {
        if actor.kind != PrincipalKind::Human {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Only members create Wake-ups",
            ));
        }
        let previous = match expected_revision {
            Some(revision) => {
                let current = authorized_rule(repo, actor, id, true, now)?;
                if current.revision != revision {
                    return Err(Failure::new(
                        ErrorCode::StaleRevision,
                        "Refresh the Wake-up before saving changes",
                    ));
                }
                Some(current)
            }
            None => {
                authorize(repo, actor, Permission::WakeRuleManageOwned, now)?;
                if let Some(current) = repo.wake_rule(id)? {
                    let details = read::read(repo, actor, id, now)?;
                    let selected: BTreeSet<_> = input.agent_ids.iter().collect();
                    let previous: BTreeSet<_> = details
                        .agents
                        .iter()
                        .map(|(_, value)| &value.agent_id)
                        .collect();
                    if current.owner_id == actor.principal_id
                        && current.revision == 0
                        && current.name == input.name.trim_matches(whitespace)
                        && current.message == input.message
                        && current.schedule == input.schedule
                        && current.enabled == input.enabled
                        && previous == selected
                        && selected.len() == input.agent_ids.len()
                    {
                        return Ok(details);
                    }
                    return Err(Failure::new(
                        ErrorCode::Conflict,
                        "Wake-up ID belongs to a different request",
                    ));
                }
                None
            }
        };
        let next = validate(repo, schedule, actor, input, now)?;
        let rule = Rule {
            id: id.to_owned(),
            owner_id: previous.as_ref().map_or_else(
                || actor.principal_id.clone(),
                |value| value.owner_id.clone(),
            ),
            configured_by_id: actor.principal_id.clone(),
            name: input.name.trim_matches(whitespace).to_owned(),
            message: input.message.clone(),
            schedule: input.schedule.clone(),
            enabled: input.enabled,
            revision: previous.as_ref().map_or(Ok(0), |value| {
                value
                    .revision
                    .checked_add(1)
                    .ok_or_else(|| Failure::new(ErrorCode::Limit, "Wake-up revision limit reached"))
            })?,
            created_at: previous.as_ref().map_or(now, |value| value.created_at),
            updated_at: now,
        };
        repo.save_wake_rule(&rule, previous.is_none())?;
        if previous.is_some() {
            repo.cancel_wake_deliveries(id)?;
        }
        assign(repo, id, &input.agent_ids, next)?;
        let action = if previous.is_some() {
            "update"
        } else {
            "create"
        };
        let mut audit = Audit::new(
            actor,
            request_id,
            "wake-rule",
            id,
            &format!("wake-rule.{action}"),
            Some(&rule.owner_id),
            now,
        );
        audit.message = format!(
            "{} Wake-up “{}”.",
            if previous.is_some() {
                "Updated"
            } else {
                "Created"
            },
            rule.name
        );
        repo.audit(&audit)?;
        read::read(repo, actor, id, now)
    })
}

pub fn remove(
    repo: &mut impl RuleRepository,
    actor: &Actor,
    id: &str,
    expected_revision: i64,
    request_id: &str,
    now: i64,
) -> Result<()> {
    repo.transaction(|repo| {
        let rule = authorized_rule(repo, actor, id, true, now)?;
        if rule.revision != expected_revision {
            return Err(Failure::new(
                ErrorCode::StaleRevision,
                "Refresh the Wake-up before deleting it",
            ));
        }
        repo.remove_wake_rule(id)?;
        let mut audit = Audit::new(
            actor,
            request_id,
            "wake-rule",
            id,
            "wake-rule.delete",
            Some(&rule.owner_id),
            now,
        );
        audit.message = format!("Deleted Wake-up “{}”.", rule.name);
        repo.audit(&audit)
    })
}
