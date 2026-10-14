use crate::{
    authorization::authorize,
    identity::Actor,
    permission::Permission,
    port::{Audit, CoreRepository},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstancePolicy {
    pub revision: i64,
    pub max_owner_agents: i64,
    pub max_agents: i64,
    pub max_pending: i64,
    pub enrollment_seconds: i64,
    pub reconcile_seconds: i64,
    pub max_message_bytes: i64,
    pub fleet_idle_timeout_seconds: i64,
    pub agent_instructions: String,
    pub signup_mode: String,
    pub invitation_issuers: String,
}

impl Default for InstancePolicy {
    fn default() -> Self {
        Self {
            revision: 0,
            max_owner_agents: 10,
            max_agents: 100,
            max_pending: 100,
            enrollment_seconds: 600,
            reconcile_seconds: 300,
            max_message_bytes: 65536,
            fleet_idle_timeout_seconds: 1800,
            agent_instructions: String::new(),
            signup_mode: "invitation".to_owned(),
            invitation_issuers: "administrators".to_owned(),
        }
    }
}

pub fn read(repo: &mut impl CoreRepository, actor: &Actor, now: i64) -> Result<InstancePolicy> {
    authorize(repo, actor, Permission::PrincipalRead, now)?;
    repo.policy()?
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Instance policy is not initialized"))
}

pub fn change(
    repo: &mut impl CoreRepository,
    actor: &Actor,
    values: &InstancePolicy,
    request_id: &str,
    now: i64,
) -> Result<i64> {
    if !(1..=100).contains(&values.max_owner_agents) || values.max_agents < values.max_owner_agents || values.max_agents > 1000
        || !(1..=1000).contains(&values.max_pending) || !(60..=3600).contains(&values.enrollment_seconds)
        || !(30..=3600).contains(&values.reconcile_seconds) || !(4096..=4194304).contains(&values.max_message_bytes)
        || !(0..=604800).contains(&values.fleet_idle_timeout_seconds)
        || !["invitation", "open"].contains(&values.signup_mode.as_str()) || !["administrators", "members"].contains(&values.invitation_issuers.as_str())
        || values.agent_instructions.len() > 8192 || values.agent_instructions.chars().any(|character| matches!(character, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}')) {
        return Err(Failure::new(ErrorCode::Invalid, "Invalid bounded instance policy"));
    }
    repo.transaction(|repo| {
        authorize(repo, actor, Permission::PolicyManage, now)?;
        let current = repo.policy()?.ok_or_else(|| {
            Failure::new(ErrorCode::Unavailable, "Instance policy is not initialized")
        })?;
        if current.revision != values.revision {
            return Err(Failure::new(ErrorCode::Conflict, "Policy revision changed"));
        }
        let mut updated = values.clone();
        updated.revision = values
            .revision
            .checked_add(1)
            .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Policy revision exhausted"))?;
        repo.save_policy(&updated)?;
        repo.audit(&Audit::new(
            actor,
            request_id,
            "instance-policy",
            "instance",
            "instance-policy.configure",
            None,
            now,
        ))?;
        Ok(updated.revision)
    })
}
