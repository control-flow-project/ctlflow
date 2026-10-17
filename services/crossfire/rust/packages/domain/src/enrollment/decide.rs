use super::{
    expire::{expire, increment},
    port::EnrollmentRepository,
    preflight::capacity,
    values::*,
};
use crate::{
    authorization::authorize,
    fleet::{
        coordination,
        values::{Credential, Fleet, Instance},
    },
    identity::{Actor, Agent, AgentCredential, Principal, PrincipalKind, Role, Status, WakeMode},
    permission::Permission,
    port::Audit,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};

pub fn bind(
    repo: &mut impl EnrollmentRepository,
    owner: &str,
    key: &str,
    items: &[Item],
    now: i64,
) -> Result<()> {
    let mut fleet = repo
        .fleet_by_key(owner, key)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Fleet has not been approved"))?;
    let mut size = repo.current_fleet_instances(&fleet)?.len();
    let mut changed = false;
    for item in items {
        let agent = item.agent_id.as_deref().ok_or_else(|| {
            Failure::new(
                ErrorCode::Conflict,
                format!("Approved roster identity is missing: {}", item.instance_key),
            )
        })?;
        if repo.fleet_instance_by_agent(agent)?.is_some_and(|binding| {
            binding.owner_id != owner
                || binding.fleet_key != key
                || binding.instance_key != item.instance_key
        }) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Agent already belongs to another fleet instance",
            ));
        }
        let previous = repo.fleet_instance(owner, key, &item.instance_key)?;
        if previous
            .as_ref()
            .is_some_and(|binding| binding.agent_id != agent)
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                format!("Fleet instance identity changed: {}", item.instance_key),
            ));
        }
        if previous
            .as_ref()
            .is_none_or(|binding| binding.retired_at.is_some())
        {
            size += 1;
            if size > 100 {
                return Err(Failure::new(
                    ErrorCode::Capacity,
                    "A fleet supports at most 100 current instances",
                ));
            }
            let binding = Instance {
                owner_id: owner.to_owned(),
                fleet_key: key.to_owned(),
                instance_key: item.instance_key.clone(),
                agent_id: agent.to_owned(),
                retired_at: None,
            };
            if previous.is_some() {
                repo.save_fleet_instance(&binding)?;
            } else {
                repo.insert_fleet_instance(&binding)?;
            }
            changed = true;
        }
    }
    if changed {
        fleet.revision = increment(fleet.revision)?;
        fleet.updated_at = now;
        repo.save_fleet(&fleet)?;
    }
    Ok(())
}
fn approve_fleet(repo: &mut impl EnrollmentRepository, request: &Request, now: i64) -> Result<()> {
    let previous = repo.fleet_by_key(&request.owner_id, &request.fleet_key)?;
    if previous
        .as_ref()
        .is_some_and(|fleet| fleet.archived_at.is_none())
    {
        return Ok(());
    }
    let fleet = if let Some(mut fleet) = previous.clone() {
        fleet.archived_at = None;
        fleet.delivery_enabled = true;
        fleet.controller_name.clone_from(&request.controller_name);
        fleet.revision = increment(fleet.revision)?;
        fleet.updated_at = now;
        fleet
    } else {
        Fleet {
            id: identity::id(),
            owner_id: request.owner_id.clone(),
            fleet_key: request.fleet_key.clone(),
            label: request.fleet_key.clone(),
            controller_name: request.controller_name.clone(),
            archived_at: None,
            delivery_enabled: true,
            revision: 0,
            created_at: now,
            updated_at: now,
        }
    };
    if previous.is_some() {
        repo.save_fleet(&fleet)?;
    } else {
        repo.insert_fleet(&fleet)?;
    }
    for (key, value) in repo.enrollment_metadata(&request.id)? {
        repo.save_fleet_metadata(&fleet.id, &key, &value)?;
    }
    repo.insert_fleet_credential(&Credential {
        id: request.id.clone(),
        fleet_id: fleet.id,
        secret_hash: request.controller_credential_hash.clone(),
        created_at: now,
        revoked_at: None,
    })
}
fn rename(
    repo: &mut impl EnrollmentRepository,
    actor: &Actor,
    item: &Item,
    request_id: &str,
    now: i64,
) -> Result<()> {
    let id = item.agent_id.as_deref().ok_or_else(|| {
        Failure::new(
            ErrorCode::Conflict,
            "A registered name requires its approved agent identity",
        )
    })?;
    let current = repo
        .agent_view(id)?
        .filter(|view| {
            actor.kind == PrincipalKind::Human
                && view.agent.owner_id == actor.principal_id
                && view.owner.status == Status::Active
        })
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Forbidden,
                "Only the active human owner may approve an agent name",
            )
        })?;
    let name = repo
        .agent_name(id)?
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Agent name is missing"))?;
    if name == item.requested_name {
        return Ok(());
    }
    repo.name_claim(&item.requested_name)?
        .filter(|name| {
            name.agent_id.is_none()
                && name.request_id.as_ref() == Some(&item.request_id)
                && name.instance_key.as_ref() == Some(&item.instance_key)
        })
        .ok_or_else(|| {
            Failure::new(ErrorCode::Conflict, "The reviewed name reservation changed")
        })?;
    repo.remove_name(&name)?;
    repo.save_name_claim(
        &Name {
            name: item.requested_name.clone(),
            agent_id: Some(id.to_owned()),
            request_id: None,
            instance_key: None,
        },
        false,
    )?;
    let mut principal = current.principal;
    principal.revision = increment(principal.revision)?;
    repo.save_principal(&principal)?;
    let mut application = current.application;
    application.next_check_at = now;
    repo.save_application(&application)?;
    let mut audit = Audit::new(
        actor,
        request_id,
        "agent",
        id,
        "agent.rename",
        Some(&current.agent.owner_id),
        now,
    );
    audit.message = format!("{name} → {}", item.requested_name);
    repo.audit(&audit)
}
pub fn decide(
    repo: &mut impl EnrollmentRepository,
    actor: &Actor,
    enrollment: &str,
    input: &Decision,
    request_id: &str,
    server_name: &str,
    now: i64,
) -> Result<DecisionResult> {
    repo.transaction(|repo| {
        expire(repo, now)?;
        let mut request = repo
            .enrollment_request(enrollment)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Enrollment not found"))?;
        authorize(
            repo,
            actor,
            if input.approve {
                Permission::EnrollmentApproveOwned
            } else if request.owner_id == actor.principal_id {
                Permission::EnrollmentRejectOwned
            } else {
                Permission::EnrollmentRejectAny
            },
            now,
        )?;
        if input.approve && actor.principal_id != request.owner_id {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Only the intended human owner may approve enrollment",
            ));
        }
        if request.state != State::Pending
            || request.revision != input.expected_revision
            || request.verification_code != input.verification_code
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Enrollment or verification code changed",
            ));
        }
        repo.principal(&request.owner_id)?
            .filter(|owner| owner.status == Status::Active)
            .ok_or_else(|| Failure::new(ErrorCode::Forbidden, "Owner must be active"))?;
        let mut items = repo.enrollment_items(enrollment)?;
        if input.approve {
            let capacity = capacity(repo, &request.owner_id)?;
            if capacity.remaining < 0 {
                return Err(Failure::new(
                    ErrorCode::Limit,
                    "Agent capacity changed; adjust the instance limits",
                ));
            }
            let mut restorations = 0;
            let mut suspended = std::collections::BTreeSet::new();
            for item in &items {
                if item.outcome != Outcome::Existing {
                    continue;
                }
                let id = item.agent_id.as_deref().ok_or_else(|| {
                    Failure::new(ErrorCode::Conflict, "Existing identity is missing")
                })?;
                let binding = repo.fleet_instance_by_agent(id)?;
                if binding
                    .as_ref()
                    .is_none_or(|binding| binding.retired_at.is_some())
                {
                    restorations += 1;
                }
                let principal = repo.principal(id)?.ok_or_else(|| {
                    Failure::new(ErrorCode::Forbidden, "Existing identity is unavailable")
                })?;
                if principal.status == Status::Revoked
                    || principal.status == Status::Suspended
                        && binding
                            .as_ref()
                            .is_none_or(|binding| binding.retired_at.is_none())
                {
                    return Err(Failure::new(
                        ErrorCode::Forbidden,
                        "Only explicitly retired identities may be restored through enrollment",
                    ));
                }
                if principal.status == Status::Suspended {
                    suspended.insert(id.to_owned());
                }
            }
            if restorations > capacity.remaining {
                return Err(Failure::new(
                    ErrorCode::Capacity,
                    "Agent restoration exceeds the current owner or instance capacity",
                ));
            }
            approve_fleet(repo, &request, now)?;
            for item in &mut items {
                if item.outcome != Outcome::Claimed {
                    continue;
                }
                repo.name_claim(&item.requested_name)?
                    .filter(|name| {
                        name.request_id.as_ref() == Some(&request.id)
                            && name.instance_key.as_ref() == Some(&item.instance_key)
                    })
                    .ok_or_else(|| {
                        Failure::new(
                            ErrorCode::NameCollision,
                            format!("Name collision: {}", item.requested_name),
                        )
                    })?;
                let id = identity::id();
                crate::registration::register(
                    repo,
                    &Principal {
                        id: id.clone(),
                        matrix_user_id: format!("@agent-{id}:{server_name}"),
                        kind: PrincipalKind::Agent,
                        status: Status::Active,
                        revision: 0,
                        created_at: now,
                    },
                    Role::Agent,
                    Some(&request.owner_id),
                    now,
                )?;
                repo.insert_agent(&Agent {
                    principal_id: id.clone(),
                    owner_id: request.owner_id.clone(),
                    wake_mode: WakeMode::Selected,
                })?;
                repo.insert_agent_credential(&AgentCredential {
                    agent_id: id.clone(),
                    provisioning_password: identity::secret()?,
                    access_token: None,
                    updated_at: now,
                })?;
                repo.save_name_claim(
                    &Name {
                        name: item.requested_name.clone(),
                        agent_id: Some(id.clone()),
                        request_id: None,
                        instance_key: None,
                    },
                    false,
                )?;
                item.agent_id = Some(id);
                repo.save_enrollment_item(item, false)?;
            }
            bind(repo, &request.owner_id, &request.fleet_key, &items, now)?;
            let policies = repo.requested_policies(enrollment)?;
            for item in &items {
                let id = item.agent_id.as_deref().ok_or_else(|| {
                    Failure::new(ErrorCode::Conflict, "Approved roster identity is missing")
                })?;
                let policy = policies.get(&item.instance_key).ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Conflict,
                        "Fleet coordination policy is missing; submit a new request",
                    )
                })?;
                let mut principal = repo
                    .principal(id)?
                    .filter(|principal| principal.status != Status::Revoked)
                    .ok_or_else(|| {
                        Failure::new(
                            ErrorCode::Forbidden,
                            "Revoked agent identities cannot be restored",
                        )
                    })?;
                if policy
                    .expected_agent_revision
                    .is_some_and(|revision| revision != principal.revision)
                {
                    return Err(Failure::new(
                        ErrorCode::Conflict,
                        "Agent changed before enrollment approval",
                    ));
                }
                if suspended.contains(id) {
                    principal.status = Status::Active;
                    repo.save_principal(&principal)?;
                }
                coordination::apply(repo, actor, id, policy, request_id, now)?;
                rename(repo, actor, item, request_id, now)?;
                if suspended.contains(id) {
                    let mut principal = repo.principal(id)?.ok_or_else(|| {
                        Failure::new(ErrorCode::Missing, "Restored agent is missing")
                    })?;
                    principal.revision = increment(principal.revision)?;
                    repo.save_principal(&principal)?;
                    let mut application = repo.application(id)?.ok_or_else(|| {
                        Failure::new(
                            ErrorCode::Unavailable,
                            "Agent native account state is missing",
                        )
                    })?;
                    application.next_check_at = now;
                    repo.save_application(&application)?;
                }
            }
        } else {
            repo.remove_request_names(enrollment)?;
        }
        request.state = if input.approve {
            State::Approved
        } else {
            State::Rejected
        };
        request.revision = increment(request.revision)?;
        request.decided_by_member_id = Some(actor.principal_id.clone());
        request.decided_at = Some(now);
        repo.save_enrollment_request(&request, false)?;
        repo.audit(&Audit::new(
            actor,
            request_id,
            "enrollment",
            enrollment,
            if input.approve {
                "enrollment.approve"
            } else {
                "enrollment.reject"
            },
            Some(&request.owner_id),
            now,
        ))?;
        Ok(DecisionResult {
            enrollment_id: enrollment.to_owned(),
            state: request.state,
            revision: request.revision,
        })
    })
}
