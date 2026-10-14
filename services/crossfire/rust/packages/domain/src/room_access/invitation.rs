use super::{
    operations::RoomOperations, owner_conversation, port::RoomRepository, reconcile,
    service::Service, values::*,
};
use crate::{
    authorization::authorize,
    identity::{Actor, Authentication, PrincipalKind},
    matrix::{MatrixAuthority, Membership},
    permission::Permission,
    port::{AgentRepository, AuthorizationRepository, RepositoryAccess},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, time::Clock};

pub struct Request<'a> {
    pub receiver: &'a Actor,
    pub agent: &'a str,
    pub room: &'a str,
    pub request_id: &'a str,
}
pub async fn accept<A: RepositoryAccess, M: MatrixAuthority, O: RoomOperations, C: Clock>(
    repository: &A,
    matrix: &M,
    operations: &O,
    clock: &C,
    input: Request<'_>,
) -> Result<bool>
where
    A::Repository: RoomRepository,
{
    let Request {
        receiver,
        agent,
        room,
        request_id,
    } = input;
    let target = repository.with(|repo| {
        authorize(
            repo,
            receiver,
            Permission::RoomInvitationAcceptSelf,
            clock.now()?,
        )?;
        if receiver.kind != PrincipalKind::Agent || receiver.principal_id != agent {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Only the invited agent may accept its invitation",
            ));
        }
        repo.agent_view(agent)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Invited agent not found"))
    })?;
    let Some(invitation) = matrix
        .invitation(&target.principal.matrix_user_id, room)
        .await?
    else {
        return Ok(false);
    };
    let bound = repository.with(|repo| repo.owner_conversation(agent))?;
    if invitation.direct
        && invitation.sender_matrix_id == target.owner.matrix_user_id
        && bound.as_ref().is_none_or(|bound| bound.room_id == room)
    {
        owner_conversation::ensure(
            repository,
            matrix,
            operations,
            clock,
            agent,
            Some(&invitation),
        )
        .await?;
        return Ok(true);
    }
    let (inviter, grant) = repository.with(|repo| {
        let sender = repo
            .principal_by_matrix_id(&invitation.sender_matrix_id)?
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Forbidden,
                    "The inviter is not a registered Crossfire identity",
                )
            })?;
        Ok((
            Actor {
                principal_id: sender.id,
                kind: sender.kind,
                authentication: Some(Authentication::Native {
                    matrix_user_id: invitation.sender_matrix_id.clone(),
                }),
            },
            repo.room_grant(agent, room)?,
        ))
    })?;
    if grant
        .as_ref()
        .is_some_and(|grant| grant.invitation_event_id.as_ref() == Some(&invitation.event_id))
    {
        if grant
            .as_ref()
            .is_some_and(|grant| grant.intent.access == Access::None)
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "This invitation was already withdrawn",
            ));
        }
    } else {
        let service = Service {
            repository,
            matrix,
            clock,
        };
        service
            .change(
                &inviter,
                &Change {
                    agent_id: agent.to_owned(),
                    room_id: room.to_owned(),
                    expected_revision: target.principal.revision,
                    expected_generation: grant.map(|grant| grant.generation),
                    intent: Intent {
                        access: Access::Reply,
                        power: None,
                        muted: false,
                    },
                },
                Some(&invitation),
                request_id,
            )
            .await?;
    }
    reconcile::reconcile(repository, matrix, operations, clock, agent, room).await?;
    let accepted = repository.with(|repo| {
        let observation = repo.room_application(agent, room)?;
        if let Some(value) = &observation
            && let Some(code) = &value.error_code
        {
            return Err(Failure::new(
                match code.as_str() {
                    "conflict" => ErrorCode::Conflict,
                    "forbidden" => ErrorCode::Forbidden,
                    _ => ErrorCode::Native,
                },
                value
                    .error_message
                    .as_deref()
                    .unwrap_or("Native invitation remains pending"),
            ));
        }
        Ok(observation.is_some_and(|value| value.membership == Some(Membership::Join)))
    })?;
    if accepted && invitation.direct {
        matrix
            .mark_direct(
                &target.principal.matrix_user_id,
                &invitation.sender_matrix_id,
                room,
            )
            .await?;
    }
    Ok(accepted)
}
