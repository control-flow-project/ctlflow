use super::{
    authority, operations::RoomOperations, port::RoomRepository, reconcile, service::commit,
    values::*,
};
use crate::{
    identity::{Actor, Authentication, PrincipalKind, Status},
    messaging::{Membership, MessagingAuthority, RoomInvitation},
    port::{AgentRepository, Audit, CoreRepository, RepositoryAccess, UnitOfWork},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, time::Clock};

async fn verify_invitation<M: MessagingAuthority>(
    messaging: &M,
    user: &str,
    invitation: &RoomInvitation,
) -> Result<()> {
    if messaging
        .invitation(user, &invitation.room_id)
        .await?
        .is_none_or(|current| {
            !current.direct
                || current.event_id != invitation.event_id
                || current.sender_backend_user_id != invitation.sender_backend_user_id
        })
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "The owner DM invitation was withdrawn or replaced",
        ));
    }
    Ok(())
}
pub async fn ensure<A: RepositoryAccess, M: MessagingAuthority, O: RoomOperations, C: Clock>(
    repository: &A,
    messaging: &M,
    operations: &O,
    clock: &C,
    agent: &str,
    invitation: Option<&RoomInvitation>,
) -> Result<String>
where
    A::Repository: RoomRepository,
{
    let _guard = operations.acquire(&format!("agent:{agent}")).await?;
    let (target, previous) = repository.with(|repo| {
        let target = repo
            .agent_view(agent)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
        if target.principal.status != Status::Active || target.owner.status != Status::Active {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Agent and owner must be active",
            ));
        }
        if target.application.applied_status != Some(Status::Active)
            || target.application.error_code.is_some()
        {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "The native agent account is not ready",
            ));
        }
        Ok((target, repo.owner_conversation(agent)?))
    })?;
    if let Some(invitation) = invitation {
        if !invitation.direct
            || invitation.sender_backend_user_id != target.owner.backend_user_id
            || previous
                .as_ref()
                .is_some_and(|previous| previous.room_id != invitation.room_id)
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "The invitation does not identify this agent’s private owner conversation",
            ));
        }
        verify_invitation(messaging, &target.principal.backend_user_id, invitation).await?;
    }
    let room = match invitation {
        Some(invitation) => {
            messaging
                .verify_owner_conversation(
                    &target.owner.backend_user_id,
                    &target.principal.backend_user_id,
                    &invitation.room_id,
                )
                .await?;
            invitation.room_id.clone()
        }
        None => {
            messaging
                .owner_conversation(
                    &target.owner.backend_user_id,
                    &target.principal.backend_user_id,
                    previous.as_ref().map(|value| value.room_id.as_str()),
                    None,
                )
                .await?
        }
    };
    if previous
        .as_ref()
        .is_some_and(|previous| previous.owner_id != target.owner.id || previous.room_id != room)
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "The native owner conversation changed",
        ));
    }
    let actor = Actor {
        principal_id: target.owner.id.clone(),
        kind: PrincipalKind::Human,
        authentication: Some(Authentication::Native {
            backend_user_id: target.owner.backend_user_id.clone(),
        }),
    };
    let input = repository.with(|repo| {
        Ok(Change {
            agent_id: agent.to_owned(),
            room_id: room.clone(),
            expected_revision: target.principal.revision,
            expected_generation: repo.room_grant(agent, &room)?.map(|grant| grant.generation),
            intent: Intent {
                access: Access::Reply,
                native_access: None,
                muted: false,
            },
        })
    })?;
    let (mut proof, owner, _) = repository
        .with(|repo| authority::prepare(repo, &actor, &input, invitation, clock.now()?))?;
    if authority::needs_native(&proof, &actor) {
        let facts = messaging
            .authorize_room_access(
                &owner,
                &target.principal.backend_user_id,
                &room,
                &input.intent,
            )
            .await?;
        proof.native = Some(facts);
    }
    if let Some(invitation) = invitation {
        verify_invitation(messaging, &target.principal.backend_user_id, invitation).await?;
    }
    let (saved, revision) = repository.with(|repo| {
        repo.transaction(|repo| {
            let now = clock.now()?;
            authority::recheck(repo, &actor, &proof, now)?;
            let bound = repo.owner_conversation(agent)?;
            if bound.as_ref().map(|value| &value.room_id)
                != previous.as_ref().map(|value| &value.room_id)
            {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Owner conversation changed during native application",
                ));
            }
            let mut grant = commit(repo, &actor, &proof, &identity::id(), true, now)?
                .filter(|grant| {
                    grant.authorizer_id == target.owner.id && grant.added_by_id == target.owner.id
                })
                .ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Forbidden,
                        "Owner conversation provenance does not match",
                    )
                })?;
            let removed = repo.room_permission(agent, &room)?.is_some();
            repo.replace_room_permissions(agent, &room, None)?;
            if removed {
                grant.revision = grant.revision.checked_add(1).ok_or_else(|| {
                    Failure::new(ErrorCode::Conflict, "Room revision exceeds native range")
                })?;
                grant.updated_at = now;
                repo.save_room_grant(&grant, false)?;
                let mut audit = Audit::new(
                    &actor,
                    &identity::id(),
                    "agent",
                    agent,
                    "owner-conversation.ensure",
                    Some(&target.owner.id),
                    now,
                );
                audit.room_id = Some(room.clone());
                repo.audit(&audit)?;
            }
            if bound.is_none() {
                repo.insert_owner_conversation(&OwnerConversation {
                    agent_id: agent.to_owned(),
                    owner_id: target.owner.id.clone(),
                    room_id: room.clone(),
                    created_at: now,
                })?;
            }
            let mut principal = target.principal.clone();
            if proof.changed || removed {
                principal.revision = principal.revision.checked_add(1).ok_or_else(|| {
                    Failure::new(ErrorCode::Conflict, "Agent revision exceeds native range")
                })?;
                repo.save_principal(&principal)?;
            }
            Ok((grant, principal.revision))
        })
    })?;
    reconcile::reconcile(repository, messaging, operations, clock, agent, &room).await?;
    repository.with(|repo| {
        let observation = repo.room_application(agent, &room)?;
        if observation.as_ref().is_none_or(|observation| {
            observation.membership != Some(Membership::Join) || observation.error_code.is_some()
        }) {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                observation
                    .and_then(|value| value.error_message)
                    .unwrap_or_else(|| "Owner conversation read and reply is not ready".to_owned()),
            ));
        }
        Ok(())
    })?;
    if messaging
        .owner_conversation(
            &target.owner.backend_user_id,
            &target.principal.backend_user_id,
            Some(&room),
            None,
        )
        .await?
        != room
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "The native owner conversation changed",
        ));
    }
    repository.with(|repo| {
        repo.transaction(|repo| {
            let current = repo.agent_view(agent)?;
            let existing = repo.owner_conversation(agent)?;
            let grant = repo.room_grant(agent, &room)?;
            if current.is_none_or(|value| {
                value.principal.revision != revision
                    || value.owner.revision != target.owner.revision
            }) || existing
                .is_none_or(|value| value.room_id != room || value.owner_id != target.owner.id)
                || grant.is_none_or(|value| {
                    value.generation != saved.generation || value.revision != saved.revision
                })
            {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Owner conversation authority changed during native application",
                ));
            }
            Ok(room)
        })
    })
}
