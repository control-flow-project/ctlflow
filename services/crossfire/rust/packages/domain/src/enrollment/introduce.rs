use super::{
    expire::{expire, increment},
    port::{EnrollmentRepository, RosterDigest},
    preflight,
    read::receipt,
    values::*,
};
use crate::{
    agent::validate_wake_senders,
    fleet::coordination,
    identity::Status,
    port::{
        AuthorizationRepository, FleetRepository, MatrixIdentity, RepositoryAccess, UnitOfWork,
    },
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};

pub async fn introduce<A: RepositoryAccess, M: MatrixIdentity>(
    repository: &A,
    matrix: &M,
    digest: &impl RosterDigest,
    input: &Introduction,
    now: i64,
) -> Result<Receipt>
where
    A::Repository: EnrollmentRepository,
{
    if input.enrollment_id.len() != 36
        || !input
            .enrollment_id
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value) || value == b'-')
        || input.claim_secret.expose().len() != 43
        || !input
            .claim_secret
            .expose()
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'_' || value == b'-')
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Persist a request UUID and private 32-byte claim before enrollment",
        ));
    }
    preflight::validate(&input.roster)?;
    let digest = digest.digest(&input.roster)?;
    if let Some(prior) = repository.with(|repo| repo.enrollment_request(&input.enrollment_id))? {
        if prior.expires_at <= now
            || prior.roster_digest != digest
            || !identity::matches(input.claim_secret.expose(), &prior.claim_hash)
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Enrollment request belongs to different credentials or roster, or has expired",
            ));
        }
        return repository.with(|repo| receipt(repo, prior));
    }
    let verified = preflight::verify(repository, matrix, &input.roster).await?;
    repository.with(|repo| {
        repo.transaction(|repo| {
            expire(repo, now)?;
            if let Some(prior) = repo.enrollment_request(&input.enrollment_id)? {
                if prior.roster_digest != digest
                    || !identity::matches(input.claim_secret.expose(), &prior.claim_hash)
                {
                    return Err(Failure::new(
                        ErrorCode::Conflict,
                        "Enrollment request belongs to different credentials or roster",
                    ));
                }
                return receipt(repo, prior);
            }
            let owner = repo
                .principal(&verified.owner_id)?
                .filter(|owner| {
                    owner.revision == verified.owner_revision && owner.status == Status::Active
                })
                .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Owner authority changed"))?;
            for item in &verified.existing {
                repo.principal(&item.agent_id)?
                    .filter(|principal| {
                        principal.revision == item.revision
                            && (principal.status == Status::Active
                                || item.retired && principal.status == Status::Suspended)
                    })
                    .ok_or_else(|| {
                        Failure::new(ErrorCode::Conflict, "Existing agent authority changed")
                    })?;
            }
            preflight::admit(repo, &input.roster, &verified)?;
            let policy = preflight::capacity(repo, &owner.id)?.policy;
            if repo.pending_enrollment_count()? >= policy.max_pending {
                return Err(Failure::new(
                    ErrorCode::Limit,
                    "Pending enrollment capacity reached",
                ));
            }
            let verification_code = identity::random_bytes::<6>()?
                .iter()
                .map(|byte| format!("{byte:02X}"))
                .collect();
            let mut request = Request {
                id: input.enrollment_id.clone(),
                owner_id: owner.id,
                fleet_key: input.roster.fleet_key.clone(),
                controller_name: input.roster.controller.name.clone(),
                controller_credential_hash: identity::hash(
                    crate::fleet::authority::controller_token(
                        &input.enrollment_id,
                        &input.claim_secret,
                    )
                    .expose(),
                ),
                verification_code,
                claim_hash: identity::hash(input.claim_secret.expose()),
                roster_digest: digest,
                state: State::Pending,
                revision: 0,
                created_at: now,
                expires_at: now
                    .checked_add(policy.enrollment_seconds * 1000)
                    .ok_or_else(|| {
                        Failure::new(ErrorCode::Limit, "Enrollment expiry exceeds native range")
                    })?,
                decided_by_member_id: None,
                decided_at: None,
            };
            repo.save_enrollment_request(&request, true)?;
            for (key, value) in &input.roster.controller.metadata {
                repo.insert_enrollment_metadata(&request.id, key, value)?;
            }
            let mut instances = Vec::with_capacity(input.roster.instances.len());
            for item in &input.roster.instances {
                let existing = verified
                    .existing
                    .iter()
                    .find(|existing| existing.instance_key == item.instance_key);
                let record = Item {
                    request_id: request.id.clone(),
                    instance_key: item.instance_key.clone(),
                    requested_name: item.name.clone(),
                    agent_id: existing.map(|existing| existing.agent_id.clone()),
                    outcome: if existing.is_some() {
                        Outcome::Existing
                    } else {
                        Outcome::Claimed
                    },
                };
                repo.save_enrollment_item(&record, true)?;
                let policy = verified.policies.get(&item.instance_key).ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Invalid,
                        "Fleet instance coordination policy is missing",
                    )
                })?;
                validate_wake_senders(
                    repo,
                    record.agent_id.as_deref(),
                    policy.mode,
                    &policy.senders,
                )?;
                repo.insert_requested_policy(&record, policy)?;
                if record.outcome == Outcome::Claimed
                    || existing.is_some_and(|existing| existing.name != item.name)
                {
                    repo.save_name_claim(
                        &Name {
                            name: item.name.clone(),
                            request_id: Some(request.id.clone()),
                            instance_key: Some(item.instance_key.clone()),
                            agent_id: None,
                        },
                        true,
                    )?;
                }
                instances.push(record);
            }
            let fleet = repo.fleet_by_key(&request.owner_id, &request.fleet_key)?;
            let mut unchanged = fleet
                .as_ref()
                .is_some_and(|fleet| fleet.archived_at.is_none())
                && !verified.existing.iter().any(|existing| {
                    existing.retired
                        || input
                            .roster
                            .instances
                            .iter()
                            .find(|item| item.instance_key == existing.instance_key)
                            .is_none_or(|item| item.name != existing.name)
                });
            for item in &instances {
                if let Some(agent) = &item.agent_id {
                    unchanged &=
                        coordination::matches(repo, agent, &verified.policies[&item.instance_key])?;
                }
            }
            if unchanged
                && instances
                    .iter()
                    .all(|item| item.outcome == Outcome::Existing)
            {
                super::decide::bind(repo, &request.owner_id, &request.fleet_key, &instances, now)?;
                request.state = State::Approved;
                request.revision = increment(request.revision)?;
                repo.save_enrollment_request(&request, false)?;
            }
            receipt(repo, request)
        })
    })
}
