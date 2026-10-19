use super::{
    authority::{self, live_receiver, rule_can_wake},
    values::{
        Attachment, Delivery, DeliveryRepository, DeliveryStatus, Metadata, Rule, ScheduledWake,
    },
};
use crate::{
    identity::Actor,
    listener::HEARTBEAT_EXPIRY_MS,
    schedule::{Schedule, ScheduleCalculator},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};

fn command(
    repo: &mut impl DeliveryRepository,
    rule: &Rule,
    delivery: &Delivery,
) -> Result<ScheduledWake> {
    let owner = repo
        .principal(&rule.owner_id)?
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Wake-up authority is missing"))?;
    let authorizer = repo
        .principal(&rule.configured_by_id)?
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Wake-up authority is missing"))?;
    Ok(ScheduledWake {
        delivery_id: delivery.id.clone(),
        rule_id: rule.id.clone(),
        rule_revision: delivery.rule_revision,
        name: rule.name.clone(),
        message: rule.message.clone(),
        scheduled_at: delivery.scheduled_at,
        session_id: delivery.session_id.clone(),
        owner_backend_user_id: owner.backend_user_id,
        authorizer_backend_user_id: authorizer.backend_user_id,
    })
}

pub fn metadata(
    repo: &mut impl DeliveryRepository,
    actor: &Actor,
    agent_id: &str,
    input: &Attachment,
    now: i64,
) -> Result<Metadata> {
    authority::attachment(input)?;
    let live = live_receiver(repo, actor, agent_id, &input.run_id, now)?;
    let next = repo.next_wake_due_at(agent_id)?;
    let pending = repo.pending_wake_delivery(agent_id)?;
    Ok(Metadata {
        now,
        next_due_at: if live
            && pending
                .as_ref()
                .is_some_and(|value| value.session_id == input.session_id)
        {
            Some(now)
        } else {
            next
        },
    })
}

pub fn claim(
    repo: &mut impl DeliveryRepository,
    schedule: &impl ScheduleCalculator,
    actor: &Actor,
    agent_id: &str,
    input: &Attachment,
    now: i64,
) -> Result<Option<ScheduledWake>> {
    repo.transaction(|repo| {
        authority::attachment(input)?;
        if !live_receiver(repo, actor, agent_id, &input.run_id, now)? {
            return Ok(None);
        }
        if let Some(mut delivery) = repo.pending_wake_delivery(agent_id)? {
            if delivery.session_id != input.session_id {
                return Ok(None);
            }
            if delivery.run_id != input.run_id
                && repo.listener_run(&delivery.run_id)?.is_some_and(|run| {
                    run.stopped_at.is_none() && run.last_seen_at >= now - HEARTBEAT_EXPIRY_MS
                })
            {
                return Ok(None);
            }
            let rule = repo
                .wake_rule(&delivery.rule_id)?
                .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Wake-up rule is missing"))?;
            if !rule_can_wake(repo, &rule, agent_id)? || rule.revision != delivery.rule_revision {
                delivery.status = DeliveryStatus::Cancelled;
                repo.save_wake_delivery(&delivery, false)?;
                return Ok(None);
            }
            delivery.run_id = input.run_id.clone();
            repo.save_wake_delivery(&delivery, false)?;
            return command(repo, &rule, &delivery).map(Some);
        }
        for (rule, mut assignment) in repo.due_wake_assignments(agent_id, now)? {
            let after = match &rule.schedule {
                Schedule::Interval { seconds } if (1..=31_536_000).contains(seconds) => {
                    let period = seconds * 1000;
                    now.checked_sub(assignment.next_due_at)
                        .and_then(|elapsed| {
                            assignment
                                .next_due_at
                                .checked_add((elapsed / period) * period)
                        })
                        .ok_or_else(|| {
                            Failure::new(
                                ErrorCode::Unavailable,
                                "Stored wake-up deadline is out of range",
                            )
                        })?
                }
                Schedule::Interval { .. } => {
                    return Err(Failure::new(
                        ErrorCode::Unavailable,
                        "Stored wake-up interval is invalid",
                    ));
                }
                Schedule::Cron { .. } => now,
            };
            let scheduled_at = assignment.next_due_at;
            assignment.next_due_at = schedule.next(&rule.schedule, after)?;
            repo.save_wake_assignment(&assignment)?;
            if !rule_can_wake(repo, &rule, agent_id)? {
                continue;
            }
            let delivery = Delivery {
                id: identity::id(),
                rule_id: rule.id.clone(),
                agent_id: agent_id.to_owned(),
                rule_revision: rule.revision,
                run_id: input.run_id.clone(),
                session_id: input.session_id.clone(),
                scheduled_at,
                created_at: now,
                status: DeliveryStatus::Pending,
                delivered_at: None,
            };
            repo.save_wake_delivery(&delivery, true)?;
            return command(repo, &rule, &delivery).map(Some);
        }
        Ok(None)
    })
}

pub fn validate(
    repo: &mut impl DeliveryRepository,
    actor: &Actor,
    agent_id: &str,
    delivery_id: &str,
    input: &Attachment,
    now: i64,
) -> Result<bool> {
    authority::attachment(input)?;
    if !live_receiver(repo, actor, agent_id, &input.run_id, now)? {
        return Ok(false);
    }
    let Some(delivery) = repo.wake_delivery(delivery_id)? else {
        return Ok(false);
    };
    if delivery.agent_id != agent_id
        || delivery.run_id != input.run_id
        || delivery.session_id != input.session_id
        || delivery.status != DeliveryStatus::Pending
    {
        return Ok(false);
    }
    let Some(rule) = repo
        .wake_rule(&delivery.rule_id)?
        .filter(|rule| rule.revision == delivery.rule_revision)
    else {
        return Ok(false);
    };
    rule_can_wake(repo, &rule, agent_id)
}

pub fn acknowledge(
    repo: &mut impl DeliveryRepository,
    actor: &Actor,
    agent_id: &str,
    delivery_id: &str,
    input: &Attachment,
    now: i64,
) -> Result<bool> {
    repo.transaction(|repo| {
        authority::attachment(input)?;
        authority::receiver(repo, actor, agent_id, now)?;
        let Some(mut value) = repo.wake_delivery(delivery_id)? else {
            return Ok(false);
        };
        authority::scheduled_receiver(repo, actor, agent_id, &input.run_id, now)?;
        if value.agent_id != agent_id
            || value.run_id != input.run_id
            || value.session_id != input.session_id
        {
            return Err(Failure::new(
                ErrorCode::Missing,
                "Wake-up receipt not found",
            ));
        }
        if value.status == DeliveryStatus::Delivered {
            return Ok(true);
        }
        value.status = DeliveryStatus::Delivered;
        value.delivered_at = Some(now);
        repo.save_wake_delivery(&value, false)?;
        let mut assignment = repo
            .wake_assignments(&[value.rule_id.clone()])?
            .into_iter()
            .find(|value| value.agent_id == agent_id)
            .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Wake-up assignment is missing"))?;
        assignment.last_delivered_at = Some(now.max(assignment.last_delivered_at.unwrap_or(0)));
        repo.save_wake_assignment(&assignment)?;
        Ok(true)
    })
}
