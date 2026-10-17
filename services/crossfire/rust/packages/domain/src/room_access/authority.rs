use super::{port::RoomRepository, values::*};
use crate::{
    authorization::{AgentAction, active_actor, authorize_agent},
    identity::{Actor, PrincipalKind, Status},
    matrix::{RoomFacts, RoomInvitation, RoomPower},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
pub fn private_room(repo: &mut impl RoomRepository, room: &str) -> Result<bool> {
    Ok(repo.owner_conversation_by_room(room)?.is_some()
        || repo.management_conversation_by_room(room)?.is_some())
}
pub fn protect(repo: &mut impl RoomRepository, input: &Change) -> Result<()> {
    let conversation = repo.owner_conversation_by_room(&input.room_id)?;
    if repo
        .management_conversation_by_room(&input.room_id)?
        .is_some()
        || conversation
            .as_ref()
            .is_some_and(|conversation| conversation.agent_id != input.agent_id)
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Another agent cannot join a private owner DM",
        ));
    }
    if conversation.is_some()
        && (input.intent.access != Access::Reply
            || input.intent.power.is_some()
            || input.intent.muted)
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Owner DMs always have read-and-reply access and cannot be muted or removed",
        ));
    }
    Ok(())
}
pub fn requested_power(facts: &RoomFacts, intent: &Intent) -> Result<i64> {
    let level = match intent.access {
        Access::Read => Some(facts.read_level),
        Access::Custom => intent.power,
        _ => Some(facts.reply_level),
    }
    .ok_or_else(|| {
        Failure::new(
            ErrorCode::Invalid,
            "A finite integer Matrix power level is required",
        )
    })?;
    if matches!(facts.power,RoomPower::Level(current) if level > current) {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Requested access exceeds the authorizer’s native room permissions",
        ));
    }
    Ok(level)
}
pub fn prepare(
    repo: &mut impl RoomRepository,
    actor: &Actor,
    input: &Change,
    invitation: Option<&RoomInvitation>,
    now: i64,
) -> Result<(Authorization, String, String)> {
    let acting = active_actor(repo, actor, now)?;
    protect(repo, input)?;
    let target = repo
        .agent_view(&input.agent_id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Target agent not found"))?;
    if input.intent.access != Access::None
        && (target.principal.status != Status::Active || target.owner.status != Status::Active)
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Target and its owner must be active",
        ));
    }
    if target.principal.revision != input.expected_revision {
        return Err(Failure::new(ErrorCode::Conflict, "Agent revision changed"));
    }
    if (input.intent.access == Access::Custom) != input.intent.power.is_some()
        || input.intent.access == Access::None && input.intent.muted
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid room access settings",
        ));
    }
    let previous = repo.room_grant(&input.agent_id, &input.room_id)?;
    let fresh = invitation.is_some_and(|invitation| {
        previous
            .as_ref()
            .and_then(|grant| grant.invitation_event_id.as_ref())
            != Some(&invitation.event_id)
    });
    if let Some(invitation) = invitation {
        if invitation.room_id != input.room_id
            || invitation.sender_matrix_id != acting.matrix_user_id
            || input.intent.access != Access::Reply
            || input.intent.power.is_some()
            || input.intent.muted
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Native invitation does not match the grant intent",
            ));
        }
        if previous.as_ref().is_some_and(|grant| {
            grant.invitation_event_id.as_ref() == Some(&invitation.event_id)
                && grant.intent.access == Access::None
        }) {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "This invitation was already withdrawn",
            ));
        }
    }
    if previous.as_ref().map(|grant| &grant.generation) != input.expected_generation.as_ref() {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Room membership generation changed",
        ));
    }
    let mut inviter_generation = None;
    let mut inviter_revision = None;
    if actor.kind == PrincipalKind::Human {
        authorize_agent(
            repo,
            actor,
            &input.agent_id,
            AgentAction::ManageRoomGrant,
            now,
        )?;
    } else {
        if input.agent_id == actor.principal_id {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "An agent cannot grant itself room access",
            ));
        }
        let inviter = repo.room_grant(&actor.principal_id, &input.room_id)?;
        let permission = repo.room_permission(&actor.principal_id, &input.room_id)?;
        let inviter = inviter
            .filter(|grant| {
                grant.intent.access != Access::None
                    && permission
                        .as_ref()
                        .is_some_and(|permission| permission.generation == grant.generation)
            })
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Forbidden,
                    "This room requires explicit agent invitation permission",
                )
            })?;
        inviter_generation = Some(inviter.generation);
        inviter_revision = Some(inviter.revision);
        if previous.as_ref().is_some_and(|grant| {
            grant.intent.access != Access::None
                && grant.added_by_id != actor.principal_id
                && (fresh || input.intent.access == Access::None || grant.intent != input.intent)
        }) {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "An agent can change or remove only its own room additions",
            ));
        }
    }
    let changed = fresh
        || previous
            .as_ref()
            .map_or(input.intent.access != Access::None, |grant| {
                grant.intent != input.intent
            });
    let needs_native = input.intent.access != Access::None
        && changed
        && (fresh
            || previous.as_ref().is_none_or(|grant| {
                grant.intent.access == Access::None
                    || grant.intent.access != input.intent.access
                    || grant.intent.power != input.intent.power
            }));
    Ok((
        Authorization {
            input: input.clone(),
            actor_revision: acting.revision,
            target_revision: target.principal.revision,
            owner_revision: target.owner.revision,
            inviter_generation,
            inviter_revision,
            authorizer_id: if needs_native {
                actor.principal_id.clone()
            } else {
                previous.as_ref().map_or_else(
                    || actor.principal_id.clone(),
                    |grant| grant.authorizer_id.clone(),
                )
            },
            native: None,
            changed,
            invitation_event_id: invitation.map(|value| value.event_id.clone()).or_else(|| {
                previous
                    .as_ref()
                    .and_then(|grant| grant.invitation_event_id.clone())
            }),
            admission: if invitation.is_some() {
                Admission::Invitation
            } else if needs_native {
                Admission::Managed
            } else {
                previous
                    .as_ref()
                    .map_or(Admission::Managed, |grant| grant.admission)
            },
            previous,
        },
        acting.matrix_user_id,
        target.principal.matrix_user_id,
    ))
}
pub fn needs_native(proof: &Authorization, actor: &Actor) -> bool {
    proof.input.intent.access != Access::None
        && (actor.kind == PrincipalKind::Agent
            || proof.changed
                && (proof.previous.as_ref().is_none_or(|grant| {
                    grant.intent.access == Access::None
                        || grant.intent.access != proof.input.intent.access
                        || grant.intent.power != proof.input.intent.power
                        || grant.invitation_event_id != proof.invitation_event_id
                })))
}
pub fn recheck(
    repo: &mut impl RoomRepository,
    actor: &Actor,
    proof: &Authorization,
    now: i64,
) -> Result<()> {
    protect(repo, &proof.input)?;
    if active_actor(repo, actor, now)?.revision != proof.actor_revision {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Acting authority changed",
        ));
    }
    let target = repo
        .agent_view(&proof.input.agent_id)?
        .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Target authority changed"))?;
    if target.principal.revision != proof.target_revision
        || target.owner.revision != proof.owner_revision
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Target authority changed",
        ));
    }
    let current = repo.room_grant(&proof.input.agent_id, &proof.input.room_id)?;
    if current
        .as_ref()
        .map(|grant| (&grant.generation, grant.revision))
        != proof
            .previous
            .as_ref()
            .map(|grant| (&grant.generation, grant.revision))
    {
        return Err(Failure::new(ErrorCode::Conflict, "Room grant changed"));
    }
    if actor.kind == PrincipalKind::Human {
        authorize_agent(
            repo,
            actor,
            &proof.input.agent_id,
            AgentAction::ManageRoomGrant,
            now,
        )?;
    } else {
        let inviter = repo.room_grant(&actor.principal_id, &proof.input.room_id)?;
        let permission = repo.room_permission(&actor.principal_id, &proof.input.room_id)?;
        if inviter.as_ref().is_none_or(|grant| {
            grant.intent.access == Access::None
                || Some(&grant.generation) != proof.inviter_generation.as_ref()
                || Some(grant.revision) != proof.inviter_revision
        }) || permission.as_ref().is_none_or(|permission| {
            Some(&permission.generation) != proof.inviter_generation.as_ref()
        }) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Room invitation authority changed",
            ));
        }
    }
    Ok(())
}
