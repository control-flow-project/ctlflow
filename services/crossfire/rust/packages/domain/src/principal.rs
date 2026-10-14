use crate::{
    identity::{
        AgentCredential, Application, Principal, PrincipalKind, Status, agent_display_name,
    },
    matrix::MatrixAuthority,
    port::{
        AgentRepository, AuthorizationRepository, CoreRepository, CredentialRepository,
        RepositoryAccess, UnitOfWork,
    },
    room_access::{
        operations::RoomOperations, port::RoomRepository, reconcile as rooms, values::Access,
    },
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret, time::Clock};

pub trait IntentHash {
    fn hash(&self, matrix_id: &str, status: Status, display_name: &str) -> Result<String>;
}
pub trait PrincipalRepository: RoomRepository + CredentialRepository {
    fn due_principals(&mut self, now: i64) -> Result<Vec<String>>;
}
struct Snapshot {
    principal: Principal,
    application: Application,
    status: Status,
    display_name: String,
    owner: Option<Principal>,
    credential: Option<AgentCredential>,
    intent_hash: String,
    next_check_at: i64,
}
async fn apply<A: RepositoryAccess, M: MatrixAuthority>(
    repository: &A,
    matrix: &M,
    snapshot: &Snapshot,
    token: &mut Option<Secret>,
) -> Result<()>
where
    A::Repository: PrincipalRepository,
{
    let principal = &snapshot.principal;
    if snapshot.status == Status::Revoked {
        let present = matrix.exists(&principal.matrix_user_id).await?;
        *token = None;
        return if present {
            matrix.deactivate(&principal.matrix_user_id).await
        } else {
            Ok(())
        };
    }
    if let Some(credential) = &snapshot.credential {
        let valid = if let Some(token) = &token {
            matrix
                .identify(token)
                .await
                .ok()
                .is_some_and(|user| user == principal.matrix_user_id)
        } else {
            false
        };
        if !valid {
            *token = Some(
                matrix
                    .provision(
                        &principal.matrix_user_id,
                        &credential.provisioning_password,
                        "CROSSFIRE_AGENT",
                    )
                    .await?
                    .access_token,
            );
        }
    }
    let joined = matrix.joined(&principal.matrix_user_id).await?;
    let permitted = if principal.kind == PrincipalKind::Agent {
        repository.with(|repo| repo.room_grants(&principal.id))?
    } else {
        Vec::new()
    };
    for room in joined {
        if snapshot.status != Status::Active
            || principal.kind == PrincipalKind::Agent
                && !permitted
                    .iter()
                    .any(|grant| grant.room_id == room && grant.intent.access != Access::None)
        {
            matrix.leave(&principal.matrix_user_id, &room).await?;
        }
    }
    if snapshot.application.applied_intent_hash.as_ref() != Some(&snapshot.intent_hash) {
        matrix
            .set_display_name(&principal.matrix_user_id, &snapshot.display_name)
            .await?;
        if principal.kind == PrincipalKind::Agent
            && snapshot.application.native_display_name.as_ref() != Some(&snapshot.display_name)
            && let Some(owner) = &snapshot.owner
            && let Some(conversation) =
                repository.with(|repo| repo.owner_conversation(&principal.id))?
        {
            let room = matrix
                .owner_conversation(
                    &owner.matrix_user_id,
                    &principal.matrix_user_id,
                    Some(&conversation.room_id),
                    snapshot.application.native_display_name.as_deref(),
                )
                .await?;
            if room != conversation.room_id {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Owner conversation changed during renaming",
                ));
            }
        }
    }
    Ok(())
}
pub async fn reconcile<A: RepositoryAccess, M: MatrixAuthority, O: RoomOperations, C: Clock>(
    repository: &A,
    matrix: &M,
    operations: &O,
    clock: &C,
    hasher: &impl IntentHash,
    id: &str,
) -> Result<()>
where
    A::Repository: PrincipalRepository,
{
    {
        let _guard = operations.acquire(&format!("agent:{id}")).await?;
        let snapshot = repository.with(|repo| {
            let principal = repo.principal(id)?.ok_or_else(|| {
                Failure::new(
                    ErrorCode::Missing,
                    "Principal reconciliation state is missing",
                )
            })?;
            let application = repo.application(id)?.ok_or_else(|| {
                Failure::new(
                    ErrorCode::Missing,
                    "Principal reconciliation state is missing",
                )
            })?;
            let policy = repo.policy()?.ok_or_else(|| {
                Failure::new(
                    ErrorCode::Missing,
                    "Principal reconciliation state is missing",
                )
            })?;
            let mut status = principal.status;
            let (display_name, owner, credential) = if principal.kind == PrincipalKind::Agent {
                let agent = repo
                    .agent_view(id)?
                    .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
                if agent.owner.status == Status::Revoked {
                    status = Status::Revoked;
                } else if agent.owner.status != Status::Active && status == Status::Active {
                    status = Status::Suspended;
                }
                let name = repo
                    .agent_name(id)?
                    .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent name is missing"))?;
                let credential = repo.agent_credential(id)?.ok_or_else(|| {
                    Failure::new(ErrorCode::Missing, "Agent credentials are missing")
                })?;
                (
                    agent_display_name(&name, &agent.owner_member.display_name),
                    Some(agent.owner),
                    Some(credential),
                )
            } else {
                let member = repo
                    .member_view(id)?
                    .ok_or_else(|| Failure::new(ErrorCode::Missing, "Member not found"))?;
                (member.member.display_name, None, None)
            };
            let intent_hash = hasher.hash(&principal.matrix_user_id, status, &display_name)?;
            let next_check_at = clock
                .now()?
                .checked_add(policy.reconcile_seconds.checked_mul(1000).ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Limit,
                        "Native reconciliation interval exceeds native range",
                    )
                })?)
                .ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Limit,
                        "Native reconciliation interval exceeds native range",
                    )
                })?;
            Ok(Snapshot {
                principal,
                application,
                status,
                display_name,
                owner,
                credential,
                intent_hash,
                next_check_at,
            })
        })?;
        let mut token = snapshot
            .credential
            .as_ref()
            .and_then(|credential| credential.access_token.clone());
        let result = apply(repository, matrix, &snapshot, &mut token).await;
        repository.with(|repo| {
            repo.transaction(|repo| {
                repo.principal(id)?
                    .filter(|principal| principal.revision == snapshot.principal.revision)
                    .ok_or_else(|| {
                        Failure::new(
                            ErrorCode::Conflict,
                            "Principal changed during native application",
                        )
                    })?;
                if let Some(owner) = &snapshot.owner {
                    repo.principal(&owner.id)?
                        .filter(|current| current.revision == owner.revision)
                        .ok_or_else(|| {
                            Failure::new(
                                ErrorCode::Conflict,
                                "Owner changed during native application",
                            )
                        })?;
                }
                let mut application = snapshot.application.clone();
                let now = clock.now()?;
                application.last_attempt_at = Some(now);
                application.next_check_at = snapshot.next_check_at;
                match result {
                    Ok(()) => {
                        if let Some(mut credential) = repo.agent_credential(id)? {
                            credential.access_token = token;
                            credential.updated_at = now;
                            repo.save_agent_credential(&credential)?;
                        }
                        application.applied_revision = Some(snapshot.principal.revision);
                        application.applied_intent_hash = Some(snapshot.intent_hash);
                        application.applied_status = Some(snapshot.status);
                        application.native_display_name = Some(snapshot.display_name);
                        application.last_success_at = Some(now);
                        application.error_code = None;
                        application.error_message = None;
                    }
                    Err(error) => {
                        application.error_code = Some(error.code.as_str().to_owned());
                        application.error_message = Some(error.message);
                    }
                }
                repo.save_application(&application)
            })
        })?;
    }
    let bound = repository.with(|repo| {
        if repo.principal(id)?.is_none_or(|principal| {
            principal.kind != PrincipalKind::Agent || principal.status != Status::Active
        }) || repo
            .agent_view(id)?
            .is_none_or(|view| view.owner.status != Status::Active)
        {
            return Ok(None);
        }
        repo.owner_conversation(id)
    })?;
    if let Some(bound) = bound {
        rooms::reconcile(repository, matrix, operations, clock, id, &bound.room_id).await?;
    }
    Ok(())
}
