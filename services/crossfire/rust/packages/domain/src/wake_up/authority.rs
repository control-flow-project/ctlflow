use super::values::{Attachment, DeliveryRepository, Rule, RuleRepository};
use crate::{
    authorization::{active_actor, authorize},
    identity::{Actor, PrincipalKind, Status},
    listener::{self, Run},
    permission::Permission,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

pub fn authorized_rule(
    repo: &mut impl RuleRepository,
    actor: &Actor,
    id: &str,
    write: bool,
    now: i64,
) -> Result<Rule> {
    if actor.kind != PrincipalKind::Human {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Only members manage Wake-ups",
        ));
    }
    active_actor(repo, actor, now)?;
    let rule = repo
        .wake_rule(id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Wake-up not found"))?;
    let permissions = repo.permissions(&actor.principal_id)?;
    let (any, owned) = if write {
        (
            Permission::WakeRuleManageAny,
            Permission::WakeRuleManageOwned,
        )
    } else {
        (Permission::WakeRuleReadAny, Permission::WakeRuleReadOwned)
    };
    if permissions.contains(&any)
        || rule.owner_id == actor.principal_id && permissions.contains(&owned)
    {
        Ok(rule)
    } else {
        Err(Failure::new(ErrorCode::Missing, "Wake-up not found"))
    }
}

pub fn receiver(
    repo: &mut impl DeliveryRepository,
    actor: &Actor,
    id: &str,
    now: i64,
) -> Result<()> {
    authorize(repo, actor, Permission::WakeDeliveryReceiveSelf, now)?;
    if actor.kind != PrincipalKind::Agent || actor.principal_id != id {
        return Err(Failure::new(
            ErrorCode::Missing,
            "Wake-up receiver not found",
        ));
    }
    Ok(())
}

pub fn scheduled_receiver(
    repo: &mut impl DeliveryRepository,
    actor: &Actor,
    id: &str,
    run_id: &str,
    now: i64,
) -> Result<Run> {
    receiver(repo, actor, id, now)?;
    repo.listener_run(run_id)?
        .filter(|run| run.agent_id == id)
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Listener run not found"))
}

pub fn live_receiver(
    repo: &mut impl DeliveryRepository,
    actor: &Actor,
    id: &str,
    run_id: &str,
    now: i64,
) -> Result<bool> {
    let run = scheduled_receiver(repo, actor, id, run_id, now)?;
    if run.stopped_at.is_some()
        || run.disconnect_requested_at.is_some()
        || run.last_seen_at < now - listener::HEARTBEAT_EXPIRY_MS
    {
        return Ok(false);
    }
    listener::controller_admission(
        repo,
        id,
        run.controller.as_ref(),
        now,
        listener::ControllerPurpose::Delivery,
    )
}

pub fn rule_can_wake(repo: &mut impl RuleRepository, rule: &Rule, id: &str) -> Result<bool> {
    if !rule.enabled {
        return Ok(false);
    }
    if repo
        .principal(&rule.owner_id)?
        .is_none_or(|value| value.status != Status::Active)
        || repo
            .principal(&rule.configured_by_id)?
            .is_none_or(|value| value.status != Status::Active)
    {
        return Ok(false);
    }
    let Some(agent) = repo.agent(id)? else {
        return Ok(false);
    };
    let permissions = repo.permissions(&rule.configured_by_id)?;
    Ok(permissions.contains(&Permission::AgentConfigureAny)
        || agent.owner_id == rule.configured_by_id
            && permissions.contains(&Permission::AgentConfigureOwned))
}

pub fn attachment(input: &Attachment) -> Result<()> {
    if input.session_id.is_empty()
        || input.session_id.encode_utf16().count() > 200
        || input
            .session_id
            .chars()
            .any(|value| value <= '\u{1f}' || value == '\u{7f}')
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid native session identity",
        ));
    }
    Ok(())
}
