use super::{port::EnrollmentRepository, values::*};
use crate::{
    fleet::{authority::authenticate_controller, values::FleetActor},
    identity::{PrincipalKind, Role, Status, WakeMode},
    port::{
        AgentRepository, AuthorizationRepository, BackendUserIdentity, CredentialRepository,
        FleetRepository, RepositoryAccess,
    },
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use std::collections::BTreeSet;

pub fn valid_name(value: &str) -> bool {
    (1..=40).contains(&value.len())
        && value
            .bytes()
            .next()
            .is_some_and(|value| value.is_ascii_lowercase())
        && value
            .bytes()
            .all(|value| value.is_ascii_lowercase() || value.is_ascii_digit() || value == b'-')
}
pub fn validate(input: &Roster) -> Result<()> {
    let controller = &input.controller;
    if controller
        .name
        .trim_matches(crossfire_kernel::text::whitespace)
        .is_empty()
        || controller.name.encode_utf16().count() > 100
        || controller.metadata.len() > 16
        || controller
            .metadata
            .iter()
            .any(|(key, value)| !valid_name(key) || value.encode_utf16().count() > 256)
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid controller descriptor",
        ));
    }
    if !crossfire_kernel::identifier::opaque(&input.owner_backend_user_id)
        || !valid_name(&input.fleet_key)
        || input.instances.is_empty()
        || input.instances.len() > 100
        || input
            .instances
            .iter()
            .any(|item| !valid_name(&item.instance_key) || !valid_name(&item.name))
        || input
            .instances
            .iter()
            .map(|item| &item.instance_key)
            .collect::<BTreeSet<_>>()
            .len()
            != input.instances.len()
        || input
            .instances
            .iter()
            .map(|item| &item.name)
            .collect::<BTreeSet<_>>()
            .len()
            != input.instances.len()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Supply one owner and a unique roster of valid lowercase names and instance keys",
        ));
    }
    for item in &input.instances {
        let policy = &item.policy;
        if policy
            .senders
            .iter()
            .any(|sender| !crossfire_kernel::identifier::opaque(&sender.backend_user_id))
            || policy.senders.len() > 2000
            || policy.mode == WakeMode::Everyone && !policy.senders.is_empty()
            || policy
                .senders
                .iter()
                .map(|sender| &sender.backend_user_id)
                .collect::<BTreeSet<_>>()
                .len()
                != policy.senders.len()
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Supply a valid wake mode and unique selected backend identities",
            ));
        }
    }
    Ok(())
}
pub fn capacity(repo: &mut impl EnrollmentRepository, owner: &str) -> Result<Capacity> {
    let policy = repo
        .policy()?
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Instance is not initialized"))?;
    let member = repo
        .member_view(owner)?
        .filter(|member| {
            member.principal.kind == PrincipalKind::Human
                && [Role::Member, Role::Administrator].contains(&member.role.role)
        })
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Forbidden,
                "An enrolled human owner role is required",
            )
        })?;
    let owner_limit = if member.role.role == Role::Administrator {
        policy.max_agents
    } else {
        policy.max_owner_agents
    };
    let add = |left: i64, right: i64| {
        left.checked_add(right)
            .ok_or_else(|| Failure::new(ErrorCode::Limit, "Enrollment count exceeds native range"))
    };
    let instance_count = add(
        repo.enrolled_agent_count(None)?,
        repo.pending_identity_count(None)?,
    )?;
    let owner_count = add(
        repo.enrolled_agent_count(Some(owner))?,
        repo.pending_identity_count(Some(owner))?,
    )?;
    Ok(Capacity {
        remaining: (policy.max_agents - instance_count).min(owner_limit - owner_count),
        policy,
        owner_limit,
        owner_count,
        instance_count,
    })
}
pub fn admit(
    repo: &mut impl EnrollmentRepository,
    input: &Roster,
    verified: &Verified,
) -> Result<()> {
    let mut collisions = Vec::new();
    for item in &input.instances {
        let name = repo.name_claim(&item.name)?;
        if name.as_ref().is_some_and(|name| {
            !verified.existing.iter().any(|existing| {
                existing.instance_key == item.instance_key
                    && name.agent_id.as_ref() == Some(&existing.agent_id)
            })
        }) {
            collisions.push(item.name.as_str());
        }
        let binding =
            repo.fleet_instance(&verified.owner_id, &input.fleet_key, &item.instance_key)?;
        if binding.is_some_and(|binding| {
            !verified.existing.iter().any(|existing| {
                existing.instance_key == item.instance_key && existing.agent_id == binding.agent_id
            })
        }) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                format!(
                    "Missing private credentials for saved fleet instance {}",
                    item.instance_key
                ),
            ));
        }
    }
    if !collisions.is_empty() {
        return Err(Failure::new(
            ErrorCode::NameCollision,
            format!("Name collision: {}", collisions.join(", ")),
        ));
    }
    let capacity = capacity(repo, &verified.owner_id)?;
    let additional = input.instances.len() as i64
        - verified
            .existing
            .iter()
            .filter(|item| item.operational)
            .count() as i64;
    if additional > capacity.remaining {
        return Err(Failure::new(
            ErrorCode::Capacity,
            format!(
                "Enrollment needs {additional} new agents; owner capacity is {}/{} and instance capacity is {}/{}. Ask an administrator to adjust the applicable limits.",
                capacity.owner_count,
                capacity.owner_limit,
                capacity.instance_count,
                capacity.policy.max_agents
            ),
        ));
    }
    Ok(())
}
pub async fn verify<A: RepositoryAccess, M: BackendUserIdentity>(
    repository: &A,
    messaging: &M,
    input: &Roster,
) -> Result<Verified>
where
    A::Repository: EnrollmentRepository,
{
    validate(input)?;
    let (owner, fleet) = repository.with(|repo| {
        let owner = repo
            .principal_by_backend_user_id(&input.owner_backend_user_id)?
            .filter(|owner| owner.kind == PrincipalKind::Human && owner.status == Status::Active)
            .ok_or_else(|| {
                Failure::new(ErrorCode::Forbidden, "An active human owner is required")
            })?;
        let fleet = repo.fleet_by_key(&owner.id, &input.fleet_key)?;
        if let Some(fleet) = &fleet
            && fleet.archived_at.is_none()
        {
            let FleetActor::Controller { fleet_id, .. } = authenticate_controller(
                repo,
                input
                    .controller_credential
                    .as_ref()
                    .unwrap_or(&Secret::new(String::new())),
            )?
            else {
                return Err(Failure::new(
                    ErrorCode::Forbidden,
                    "Enrollment requires controller authentication",
                ));
            };
            if fleet_id != fleet.id {
                return Err(Failure::new(
                    ErrorCode::Forbidden,
                    "Controller credential belongs to another fleet",
                ));
            }
        } else if input.controller_credential.is_some() {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Controller credential has no fleet",
            ));
        }
        Ok((owner, fleet))
    })?;
    let mut existing = Vec::new();
    for item in &input.instances {
        let candidate = repository.with(|repo| {
            let binding = repo.fleet_instance(&owner.id,&input.fleet_key,&item.instance_key)?;
            if binding.as_ref().is_some_and(|binding| item.identity.as_ref().is_none_or(|proof| proof.agent_id != binding.agent_id)) {
                return Err(Failure::new(ErrorCode::Conflict,format!("Missing matching private credentials for saved fleet instance {}",item.instance_key)));
            }
            let Some(proof) = &item.identity else { return Ok(None); };
            let record = repo.agent_view(&proof.agent_id)?;
            let current = repo.fleet_instance_by_agent(&proof.agent_id)?;
            let retired = current.as_ref().is_some_and(|current| current.retired_at.is_some());
            let record = record.filter(|record| record.agent.owner_id == owner.id && record.owner.status == Status::Active
                && (record.principal.status == Status::Active || retired && record.principal.status == Status::Suspended))
                .ok_or_else(|| Failure::new(ErrorCode::Forbidden,"Existing identity proof does not match the owner and agent"))?;
            if let Some(current) = &current && (current.fleet_key != input.fleet_key || current.owner_id != owner.id || current.instance_key != item.instance_key) {
                return Err(Failure::new(ErrorCode::Conflict,"Agent already belongs to another fleet instance"));
            }
            if retired && repo.agent_credential(&proof.agent_id)?.is_none_or(|credential| credential.access_token.as_ref() != Some(&proof.access_token)) {
                return Err(Failure::new(ErrorCode::Forbidden,"Retired identity requires its preserved private credentials and owner approval"));
            }
            let name = repo.agent_name(&proof.agent_id)?.ok_or_else(|| Failure::new(ErrorCode::Unavailable,"Existing agent name is missing"))?;
            Ok(Some((record,current,retired,name)))
        })?;
        let Some((record, current, retired, name)) = candidate else {
            continue;
        };
        if !retired
            && messaging
                .identify(
                    &item
                        .identity
                        .as_ref()
                        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Missing private proof"))?
                        .access_token,
                )
                .await?
                != record.principal.backend_user_id
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Native identity does not match this agent",
            ));
        }
        existing.push(Existing {
            instance_key: item.instance_key.clone(),
            agent_id: record.principal.id,
            name,
            revision: record.principal.revision,
            retired,
            operational: current.is_some_and(|current| current.retired_at.is_none())
                && fleet
                    .as_ref()
                    .is_some_and(|fleet| fleet.archived_at.is_none()),
        });
    }
    let policies = repository.with(|repo| {
        input
            .instances
            .iter()
            .map(|item| {
                let identity = existing
                    .iter()
                    .find(|identity| identity.instance_key == item.instance_key);
                let requested = crate::fleet::coordination::resolve(
                    repo,
                    &item.policy,
                    identity.map(|identity| identity.agent_id.as_str()),
                    identity.map(|identity| identity.revision),
                )?;
                Ok((item.instance_key.clone(), requested))
            })
            .collect::<Result<_>>()
    })?;
    Ok(Verified {
        owner_id: owner.id,
        owner_revision: owner.revision,
        existing,
        policies,
    })
}
pub async fn preflight<A: RepositoryAccess, M: BackendUserIdentity>(
    repository: &A,
    messaging: &M,
    input: &Roster,
) -> Result<Verified>
where
    A::Repository: EnrollmentRepository,
{
    let verified = verify(repository, messaging, input).await?;
    repository.with(|repo| admit(repo, input, &verified))?;
    Ok(verified)
}
