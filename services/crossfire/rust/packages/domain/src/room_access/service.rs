use super::{authority, port::RoomRepository, values::*};
use crate::{
    authorization::{AgentAction, authorize_agent},
    identity::{Actor, PrincipalKind, Status},
    matrix::{MatrixAuthority, RoomInvitation, RoomPower},
    port::{
        AgentRepository, Audit, AuthorizationRepository, CoreRepository, RepositoryAccess,
        UnitOfWork,
    },
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, time::Clock};

pub struct Service<'a, Access, Matrix, Time> {
    pub repository: &'a Access,
    pub matrix: &'a Matrix,
    pub clock: &'a Time,
}
pub struct Changed {
    pub grant: Option<Grant>,
    pub revision: i64,
}
fn revision(value: i64) -> Result<i64> {
    value.checked_add(1).ok_or_else(|| {
        Failure::new(
            ErrorCode::Conflict,
            "Room authority revision exceeds native range",
        )
    })
}
pub fn apply_fleet_permissions(
    repo: &mut impl RoomRepository,
    grant: &Grant,
    now: i64,
) -> Result<()> {
    let Some(policy) = repo.approved_fleet_policy(&grant.agent_id)? else {
        return Ok(());
    };
    if grant.intent.access == Access::None || authority::private_room(repo, &grant.room_id)? {
        return Ok(());
    }
    if repo
        .principal(&policy.approved_by_member_id)?
        .is_none_or(|owner| owner.status != Status::Active)
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "The fleet policy owner must be active",
        ));
    }
    let permission = policy.invite_agents.then(|| Permission {
        agent_id: grant.agent_id.clone(),
        room_id: grant.room_id.clone(),
        generation: grant.generation.clone(),
        granted_by_member_id: policy.approved_by_member_id,
        granted_at: now,
    });
    repo.replace_room_permissions(&grant.agent_id, &grant.room_id, permission.as_ref())
}
pub(super) fn commit(
    repo: &mut impl RoomRepository,
    actor: &Actor,
    proof: &Authorization,
    request_id: &str,
    owner_conversation: bool,
    now: i64,
) -> Result<Option<Grant>> {
    if !proof.changed {
        return Ok(proof.previous.clone());
    }
    let input = &proof.input;
    let previous = &proof.previous;
    let fresh = previous.as_ref().is_none_or(|grant| {
        grant.intent.access == Access::None && input.intent.access != Access::None
            || proof.invitation_event_id.is_some()
                && proof.invitation_event_id != grant.invitation_event_id
    });
    let access_changed = previous.as_ref().is_none_or(|grant| {
        grant.intent.access != input.intent.access || grant.intent.power != input.intent.power
    });
    let generation = if fresh {
        identity::id()
    } else {
        previous
            .as_ref()
            .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Missing membership generation"))?
            .generation
            .clone()
    };
    if fresh || input.intent.access == Access::None {
        repo.replace_room_permissions(&input.agent_id, &input.room_id, None)?;
    }
    let grant = Grant {
        agent_id: input.agent_id.clone(),
        room_id: input.room_id.clone(),
        generation: generation.clone(),
        authorizer_id: proof.authorizer_id.clone(),
        added_by_id: if fresh {
            actor.principal_id.clone()
        } else {
            previous
                .as_ref()
                .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Missing prior grant"))?
                .added_by_id
                .clone()
        },
        invitation_event_id: proof.invitation_event_id.clone(),
        admission: proof.admission,
        intent: input.intent.clone(),
        revision: revision(previous.as_ref().map_or(-1, |grant| grant.revision))?,
        access_revision: previous
            .as_ref()
            .map_or(-1, |grant| grant.access_revision)
            .checked_add(i64::from(access_changed))
            .ok_or_else(|| {
                Failure::new(ErrorCode::Conflict, "Access revision exceeds native range")
            })?,
        updated_at: now,
    };
    repo.save_room_grant(&grant, previous.is_none())?;
    if !owner_conversation && fresh && input.intent.access != Access::None {
        apply_fleet_permissions(repo, &grant, now)?;
    }
    let application = repo.room_application(&input.agent_id, &input.room_id)?;
    let insert = application.is_none();
    let mut application =
        application.unwrap_or_else(|| Application::pending(&input.agent_id, &input.room_id, now));
    application.next_check_at = now;
    repo.save_room_application(&application, insert)?;
    let owner = repo.agent(&input.agent_id)?.map(|agent| agent.owner_id);
    let mut audit = Audit::new(
        actor,
        request_id,
        "agent",
        &input.agent_id,
        if input.intent.access == Access::None {
            "room-grant.remove"
        } else {
            "room-grant.set"
        },
        owner.as_deref(),
        now,
    );
    audit.room_id = Some(input.room_id.clone());
    audit.membership_generation = Some(generation);
    audit.authorizer_id = Some(grant.authorizer_id.clone());
    audit.added_by_id = Some(grant.added_by_id.clone());
    if actor.kind == PrincipalKind::Agent {
        audit.permission_code = Some("room.agent.invite".to_owned());
    }
    repo.audit(&audit)?;
    Ok(Some(grant))
}
impl<A: RepositoryAccess, M: MatrixAuthority, C: Clock> Service<'_, A, M, C>
where
    A::Repository: RoomRepository,
{
    pub async fn authorize(
        &self,
        actor: &Actor,
        input: &Change,
        invitation: Option<&RoomInvitation>,
    ) -> Result<Authorization> {
        let (mut proof, acting, target) = self
            .repository
            .with(|repo| authority::prepare(repo, actor, input, invitation, self.clock.now()?))?;
        if authority::needs_native(&proof, actor) {
            let facts = self.matrix.room(&acting, &input.room_id).await?;
            if actor.kind == PrincipalKind::Agent
                && matches!(facts.power,RoomPower::Level(level) if level < facts.invite_level)
            {
                return Err(Failure::new(
                    ErrorCode::Forbidden,
                    "The inviter lacks native Matrix invitation authority",
                ));
            }
            if facts.creator_ids.contains(&target) && input.intent.access != Access::Reply {
                return Err(Failure::new(
                    ErrorCode::Forbidden,
                    "A native room creator can have read-and-reply access or no membership; its Matrix authority cannot be restricted",
                ));
            }
            authority::requested_power(&facts, &input.intent)?;
            proof.native = Some(facts);
        }
        Ok(proof)
    }
    pub async fn change(
        &self,
        actor: &Actor,
        input: &Change,
        invitation: Option<&RoomInvitation>,
        request_id: &str,
    ) -> Result<Changed> {
        let proof = self.authorize(actor, input, invitation).await?;
        self.repository.with(|repo| {
            repo.transaction(|repo| {
                let now = self.clock.now()?;
                authority::recheck(repo, actor, &proof, now)?;
                let grants = repo.room_grants(&input.agent_id)?;
                let conversation = repo.owner_conversation(&input.agent_id)?;
                if input.intent.access != Access::None
                    && proof
                        .previous
                        .as_ref()
                        .is_none_or(|grant| grant.intent.access == Access::None)
                    && grants
                        .iter()
                        .filter(|grant| {
                            grant.intent.access != Access::None
                                && conversation.as_ref().is_none_or(|conversation| {
                                    conversation.room_id != grant.room_id
                                })
                        })
                        .count()
                        >= 100
                {
                    return Err(Failure::new(
                        ErrorCode::Limit,
                        "An agent can have at most 100 room grants in addition to its owner DM",
                    ));
                }
                let grant = commit(repo, actor, &proof, request_id, false, now)?;
                if !proof.changed {
                    return Ok(Changed {
                        grant,
                        revision: input.expected_revision,
                    });
                }
                let mut principal = repo
                    .principal(&input.agent_id)?
                    .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
                principal.revision = revision(principal.revision)?;
                repo.save_principal(&principal)?;
                Ok(Changed {
                    grant,
                    revision: principal.revision,
                })
            })
        })
    }
    pub fn set_permission(
        &self,
        actor: &Actor,
        input: &PermissionChange,
        request_id: &str,
    ) -> Result<i64> {
        self.repository.with(|repo| {
            repo.transaction(|repo| {
                let now = self.clock.now()?;
                if actor.kind != PrincipalKind::Human {
                    return Err(Failure::new(
                        ErrorCode::Forbidden,
                        "Agents cannot delegate invitation permission onward",
                    ));
                }
                authorize_agent(
                    repo,
                    actor,
                    &input.agent_id,
                    AgentAction::ManageRoomGrant,
                    now,
                )?;
                if authority::private_room(repo, &input.room_id)? {
                    return Err(Failure::new(
                        ErrorCode::Forbidden,
                        "Owner DMs are private channels and cannot delegate invitations",
                    ));
                }
                let target = repo
                    .agent_view(&input.agent_id)?
                    .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent not found"))?;
                if target.principal.revision != input.expected_revision {
                    return Err(Failure::new(ErrorCode::Conflict, "Agent revision changed"));
                }
                if target.principal.status != Status::Active
                    || target.owner.status != Status::Active
                {
                    return Err(Failure::new(
                        ErrorCode::Forbidden,
                        "Agent and owner must be active",
                    ));
                }
                let mut grant = repo
                    .room_grant(&input.agent_id, &input.room_id)?
                    .filter(|grant| {
                        grant.intent.access != Access::None
                            && grant.generation == input.expected_generation
                    })
                    .ok_or_else(|| {
                        Failure::new(
                            ErrorCode::Conflict,
                            "An active matching room grant is required",
                        )
                    })?;
                let permission = input.invite_agents.then(|| Permission {
                    agent_id: input.agent_id.clone(),
                    room_id: input.room_id.clone(),
                    generation: grant.generation.clone(),
                    granted_by_member_id: actor.principal_id.clone(),
                    granted_at: now,
                });
                repo.replace_room_permissions(
                    &input.agent_id,
                    &input.room_id,
                    permission.as_ref(),
                )?;
                let mut principal = target.principal;
                principal.revision = revision(principal.revision)?;
                repo.save_principal(&principal)?;
                grant.revision = revision(grant.revision)?;
                grant.updated_at = now;
                repo.save_room_grant(&grant, false)?;
                let mut audit = Audit::new(
                    actor,
                    request_id,
                    "agent",
                    &input.agent_id,
                    "room-permission.set",
                    Some(&target.owner.id),
                    now,
                );
                audit.room_id = Some(input.room_id.clone());
                audit.membership_generation = Some(grant.generation);
                audit.permission_code = Some("room.agent.invite".to_owned());
                repo.audit(&audit)?;
                Ok(principal.revision)
            })
        })
    }
}
