use super::{
    authority::requested_power, operations::RoomOperations, port::RoomRepository, values::*,
};
use crate::{
    identity::{AgentView, Principal, PrincipalKind, Status},
    matrix::{
        AccessMode, MatrixAuthority, Membership, RoomAccess, RoomAdmission, RoomMembership,
        RoomPower,
    },
    port::{
        AgentRepository, AuthorizationRepository, CoreRepository, RepositoryAccess, UnitOfWork,
    },
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::Clock};

struct Snapshot {
    agent: AgentView,
    grant: Grant,
    application: Application,
    authorizer: Option<Principal>,
    reconcile_seconds: i64,
    repair_owner: bool,
}
struct Outcome {
    result: Result<()>,
    observed: Option<RoomMembership>,
}
fn departed(snapshot: &Snapshot, observed: &Option<RoomMembership>) -> RoomMembership {
    RoomMembership {
        matrix_user_id: snapshot.agent.principal.matrix_user_id.clone(),
        display_name: String::new(),
        membership: Membership::Leave,
        power: if snapshot.application.creator
            || observed
                .as_ref()
                .is_some_and(|value| value.power == RoomPower::Creator)
        {
            RoomPower::Creator
        } else {
            RoomPower::Level(0)
        },
    }
}
async fn remove<A: RepositoryAccess, M: MatrixAuthority>(
    repository: &A,
    matrix: &M,
    snapshot: &Snapshot,
    observed: &mut Option<RoomMembership>,
) -> Result<()>
where
    A::Repository: RoomRepository,
{
    let user = &snapshot.agent.principal.matrix_user_id;
    let rooms = match matrix.joined(user).await {
        Ok(rooms) => rooms,
        Err(error) => {
            if (snapshot.agent.principal.status == Status::Revoked
                || snapshot.agent.owner.status == Status::Revoked)
                && repository
                    .with(|repo| repo.application(&snapshot.grant.agent_id))?
                    .is_some_and(|value| value.applied_status == Some(Status::Revoked))
            {
                *observed = Some(departed(snapshot, observed));
                return Ok(());
            }
            return Err(error);
        }
    };
    if rooms.contains(&snapshot.grant.room_id) {
        matrix.leave(user, &snapshot.grant.room_id).await?;
    } else if let Some(event) = &snapshot.grant.invitation_event_id
        && matrix
            .invitation(user, &snapshot.grant.room_id)
            .await?
            .is_some_and(|invitation| &invitation.event_id == event)
    {
        matrix.leave(user, &snapshot.grant.room_id).await?;
    }
    *observed = Some(departed(snapshot, observed));
    Ok(())
}
async fn apply<A: RepositoryAccess, M: MatrixAuthority>(
    repository: &A,
    matrix: &M,
    snapshot: &Snapshot,
) -> Outcome
where
    A::Repository: RoomRepository,
{
    let mut observed = None;
    let result = async {
        let grant = &snapshot.grant;
        let agent = &snapshot.agent;
        if grant.intent.access == Access::None
            || agent.principal.status != Status::Active
            || agent.owner.status != Status::Active
        {
            return remove(repository, matrix, snapshot, &mut observed).await;
        }
        if snapshot.repair_owner {
            let verified = matrix
                .owner_conversation(
                    &agent.owner.matrix_user_id,
                    &agent.principal.matrix_user_id,
                    Some(&grant.room_id),
                    None,
                )
                .await?;
            if verified != grant.room_id {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "The owner DM changed during reconciliation",
                ));
            }
        }
        let Some(authorizer) = snapshot
            .authorizer
            .as_ref()
            .filter(|authorizer| authorizer.status == Status::Active)
        else {
            remove(repository, matrix, snapshot, &mut observed).await?;
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "The grant authorizer is no longer active",
            ));
        };
        if authorizer.kind == PrincipalKind::Agent {
            let permitted = repository.with(|repo| {
                let inviter = repo.agent_view(&authorizer.id)?;
                let delegated = repo.room_grant(&authorizer.id, &grant.room_id)?;
                let permission = repo.room_permission(&authorizer.id, &grant.room_id)?;
                Ok(
                    inviter.is_some_and(|inviter| inviter.owner.status == Status::Active)
                        && delegated.is_some_and(|delegated| {
                            delegated.intent.access != Access::None
                                && permission.is_some_and(|permission| {
                                    permission.generation == delegated.generation
                                })
                        }),
                )
            })?;
            if !permitted {
                remove(repository, matrix, snapshot, &mut observed).await?;
                return Err(Failure::new(
                    ErrorCode::Forbidden,
                    "The inviting agent no longer has delegation for this room",
                ));
            }
        }
        let facts = match matrix
            .room(&authorizer.matrix_user_id, &grant.room_id)
            .await
        {
            Ok(facts) => facts,
            Err(error) => {
                remove(repository, matrix, snapshot, &mut observed).await?;
                return Err(error);
            }
        };
        let native = matrix
            .membership(
                &authorizer.matrix_user_id,
                &agent.principal.matrix_user_id,
                &grant.room_id,
            )
            .await?;
        observed = Some(native.clone());
        let command = snapshot.repair_owner
            || snapshot.application.observed_generation.as_ref() != Some(&grant.generation)
            || snapshot.application.applied_access_revision != Some(grant.access_revision);
        if !command && native.membership != Membership::Join {
            return Ok(());
        }
        let mut intent = grant.intent.clone();
        if intent.access == Access::Custom
            && let RoomPower::Level(level) = facts.power
        {
            intent.power = intent.power.map(|power| power.min(level));
        }
        let requested = match requested_power(&facts, &intent) {
            Ok(power) => power,
            Err(error) => {
                remove(repository, matrix, snapshot, &mut observed).await?;
                return Err(error);
            }
        };
        let power_level = match (command, native.power) {
            (false, RoomPower::Level(power)) => requested.min(power),
            _ => requested,
        };
        let admission = if command {
            Some(match grant.admission {
                Admission::Managed => RoomAdmission::Managed,
                Admission::Invitation => RoomAdmission::Invitation {
                    event_id: grant.invitation_event_id.clone().ok_or_else(|| {
                        Failure::new(
                            ErrorCode::Conflict,
                            "An invitation grant requires its exact native event",
                        )
                    })?,
                    sender_matrix_id: authorizer.matrix_user_id.clone(),
                },
            })
        } else {
            None
        };
        let mode = match intent.access {
            Access::Read => AccessMode::Read,
            Access::Reply => AccessMode::Reply,
            Access::Custom => AccessMode::Custom,
            Access::None => {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "No-access grants cannot join a native room",
                ));
            }
        };
        let changed = match matrix
            .set_room_access(
                &authorizer.matrix_user_id,
                &agent.principal.matrix_user_id,
                &grant.room_id,
                RoomAccess { mode, power_level },
                admission.as_ref(),
            )
            .await
        {
            Ok(changed) => changed,
            Err(error) => {
                remove(repository, matrix, snapshot, &mut observed).await?;
                return Err(error);
            }
        };
        observed = Some(changed);
        Ok(())
    }
    .await;
    Outcome { result, observed }
}
pub async fn reconcile<A: RepositoryAccess, M: MatrixAuthority, O: RoomOperations, C: Clock>(
    repository: &A,
    matrix: &M,
    operations: &O,
    clock: &C,
    agent: &str,
    room: &str,
) -> Result<()>
where
    A::Repository: RoomRepository,
{
    let _guard = operations.acquire(room).await?;
    let snapshot = repository.with(|repo| {
        let agent = repo.agent_view(agent)?.ok_or_else(|| {
            Failure::new(
                ErrorCode::Missing,
                "Room grant reconciliation state is missing",
            )
        })?;
        let grant = repo.room_grant(&agent.principal.id, room)?.ok_or_else(|| {
            Failure::new(
                ErrorCode::Missing,
                "Room grant reconciliation state is missing",
            )
        })?;
        let application = repo
            .room_application(&agent.principal.id, room)?
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Missing,
                    "Room grant reconciliation state is missing",
                )
            })?;
        let policy = repo.policy()?.ok_or_else(|| {
            Failure::new(
                ErrorCode::Missing,
                "Room grant reconciliation state is missing",
            )
        })?;
        let conversation = repo.owner_conversation(&agent.principal.id)?;
        let repair_owner = conversation.is_some_and(|conversation| conversation.room_id == room)
            && application.observed_generation.as_ref() == Some(&grant.generation)
            && application.applied_access_revision == Some(grant.access_revision)
            && application.last_success_at.is_some();
        let authorizer = repo.principal(&grant.authorizer_id)?;
        Ok(Snapshot {
            agent,
            grant,
            application,
            authorizer,
            reconcile_seconds: policy.reconcile_seconds,
            repair_owner,
        })
    })?;
    let outcome = apply(repository, matrix, &snapshot).await;
    repository.with(|repo| {
        repo.transaction(|repo| {
            let current = repo.room_grant(agent, room)?;
            let identity = repo.agent_view(agent)?;
            if current.is_none_or(|current| {
                current.generation != snapshot.grant.generation
                    || current.revision != snapshot.grant.revision
            }) || identity.is_none_or(|identity| {
                identity.principal.revision != snapshot.agent.principal.revision
                    || identity.owner.revision != snapshot.agent.owner.revision
            }) {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Grant authority changed during native application",
                ));
            }
            if repo
                .principal(&snapshot.grant.authorizer_id)?
                .map(|authorizer| authorizer.revision)
                != snapshot
                    .authorizer
                    .as_ref()
                    .map(|authorizer| authorizer.revision)
            {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Grant authorizer changed during native application",
                ));
            }
            let now = clock.now()?;
            let mut value = snapshot.application;
            value.last_attempt_at = Some(now);
            value.next_check_at = now
                .checked_add(
                    snapshot
                        .reconcile_seconds
                        .checked_mul(1000)
                        .ok_or_else(|| {
                            Failure::new(
                                ErrorCode::Limit,
                                "Reconciliation interval exceeds native range",
                            )
                        })?,
                )
                .ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Limit,
                        "Reconciliation timestamp exceeds native range",
                    )
                })?;
            if let Some(observed) = outcome.observed {
                value.membership = Some(observed.membership);
                value.creator = observed.power == RoomPower::Creator;
                value.power = match observed.power {
                    RoomPower::Creator => None,
                    RoomPower::Level(power) => Some(power),
                };
            }
            match outcome.result {
                Ok(()) => {
                    value.observed_generation = Some(snapshot.grant.generation);
                    value.applied_revision = Some(snapshot.grant.revision);
                    value.applied_access_revision = Some(snapshot.grant.access_revision);
                    value.last_success_at = Some(now);
                    value.error_code = None;
                    value.error_message = None;
                }
                Err(error) => {
                    value.error_code = Some(error.code.as_str().to_owned());
                    value.error_message = Some(error.message);
                }
            }
            repo.save_room_application(&value, false)
        })
    })
}
