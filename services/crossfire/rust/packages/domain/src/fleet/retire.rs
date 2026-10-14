use super::{
    authority::authorize_fleet,
    control::live_connection,
    native_stop::{RetirementRepository, Selection, eligibility},
    values::{FleetActor, Instance},
};
use crate::{
    identity::Status,
    port::{Audit, AuditActor},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
fn audit(
    actor: &FleetActor,
    request: &str,
    target: &str,
    id: &str,
    action: &str,
    owner: &str,
    now: i64,
) -> Audit {
    Audit {
        actor: match actor {
            FleetActor::Principal(actor) => AuditActor::Principal(actor.clone()),
            FleetActor::Controller { credential_id, .. } => AuditActor::Controller {
                credential_id: credential_id.clone(),
            },
        },
        request_id: request.to_owned(),
        target_kind: target.to_owned(),
        target_id: id.to_owned(),
        action: action.to_owned(),
        owner_id: Some(owner.to_owned()),
        created_at: now,
        message: String::new(),
        room_id: None,
        membership_generation: None,
        authorizer_id: None,
        added_by_id: None,
        permission_code: None,
    }
}
fn instance(repo: &mut impl RetirementRepository, value: &Instance, now: i64) -> Result<()> {
    if value.retired_at.is_some() {
        return Ok(());
    }
    repo.save_fleet_instance(&Instance {
        retired_at: Some(now),
        ..value.clone()
    })?;
    let mut principal = repo
        .principal(&value.agent_id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent identity no longer exists"))?;
    if principal.status == Status::Active {
        principal.status = Status::Suspended;
        principal.revision = principal
            .revision
            .checked_add(1)
            .ok_or_else(|| Failure::new(ErrorCode::Limit, "Agent revision exceeds native range"))?;
        repo.save_principal(&principal)?;
        let mut application = repo.application(&value.agent_id)?.ok_or_else(|| {
            Failure::new(
                ErrorCode::Unavailable,
                "Agent native account state is missing",
            )
        })?;
        application.next_check_at = now;
        repo.save_application(&application)?;
    }
    repo.retire_listener_runs(&value.agent_id, now)
}
fn require_controller(
    repo: &mut impl RetirementRepository,
    actor: &FleetActor,
    fleet: &str,
    now: i64,
) -> Result<()> {
    if matches!(actor, FleetActor::Controller { .. }) {
        let connection = repo.fleet_connection(fleet)?.ok_or_else(|| {
            Failure::new(
                ErrorCode::Conflict,
                "An authenticated current controller lease is required to retire",
            )
        })?;
        live_connection(repo, actor, fleet, &connection.connection_id, now)?;
    }
    Ok(())
}
pub struct Remove<'a> {
    pub fleet: &'a str,
    pub agent: &'a str,
    pub instance: &'a str,
    pub expected_revision: i64,
    pub request_id: &'a str,
}
pub fn remove(
    repo: &mut impl RetirementRepository,
    actor: &FleetActor,
    input: Remove<'_>,
    now: i64,
) -> Result<()> {
    repo.transaction(|repo| {
        let mut fleet=repo.fleet(input.fleet)?.filter(|fleet| fleet.archived_at.is_none()).ok_or_else(|| Failure::new(ErrorCode::Missing,"Current fleet not found"))?;
        authorize_fleet(repo,actor,&fleet,true,now)?;require_controller(repo,actor,&fleet.id,now)?;
        if fleet.revision!=input.expected_revision {return Err(Failure::new(ErrorCode::StaleRevision,"Refresh the fleet before retiring an instance"));}
        let bound=repo.fleet_instance(&fleet.owner_id,&fleet.fleet_key,input.instance)?.filter(|bound| bound.agent_id==input.agent).ok_or_else(|| Failure::new(ErrorCode::Conflict,"Instance membership does not match"))?;
        if bound.retired_at.is_none() {
            let ids=[input.agent.to_owned()];
            if eligibility(repo,Selection::Agents(&ids),now)?.agents.get(input.agent).is_none_or(|(id,eligible)| id!=input.fleet || !eligible) {return Err(Failure::new(ErrorCode::Conflict,"Stop the native session through its controller and settle all pending receipts before retirement"));}
        }
        instance(repo,&bound,now)?;fleet.revision=fleet.revision.checked_add(1).ok_or_else(|| Failure::new(ErrorCode::Limit,"Fleet revision exceeds native range"))?;fleet.updated_at=now;repo.save_fleet(&fleet)?;
        let mut audit=audit(actor,input.request_id,"agent",input.agent,"fleet.agent.retire",&fleet.owner_id,now);audit.message=format!("{}/{}",input.fleet,input.instance);repo.audit(&audit)
    })
}
pub fn archive(
    repo: &mut impl RetirementRepository,
    actor: &FleetActor,
    id: &str,
    revision: i64,
    request_id: &str,
    now: i64,
) -> Result<()> {
    repo.transaction(|repo| {
        let mut fleet=repo.fleet(id)?.ok_or_else(|| Failure::new(ErrorCode::Missing,"Fleet not found"))?;
        authorize_fleet(repo,actor,&fleet,true,now)?;require_controller(repo,actor,id,now)?;
        if fleet.revision!=revision {return Err(Failure::new(ErrorCode::StaleRevision,"Refresh the fleet before archiving"));}
        let instances=repo.current_fleet_instances(&fleet)?;let ids=[id.to_owned()];let eligibility=eligibility(repo,Selection::Fleets(&ids),now)?;
        if eligibility.pending_fleet_ids.contains(id) {return Err(Failure::new(ErrorCode::Conflict,"Finish the pending session operation before archiving"));}
        for bound in &instances {
            if eligibility.agents.get(&bound.agent_id).is_none_or(|(fleet,eligible)| fleet!=id || !eligible) {return Err(Failure::new(ErrorCode::Conflict,"Stop the native sessions through their controller and settle all pending receipts before archiving"));}
        }
        for bound in instances {instance(repo,&bound,now)?;}
        repo.revoke_fleet_credentials(id,now)?;
        if let Some(mut connection)=repo.fleet_connection(id)?.filter(|connection| connection.closed_at.is_none()) {connection.closed_at=Some(now);repo.save_fleet_connection(&connection)?;}
        fleet.archived_at=Some(now);fleet.delivery_enabled=false;fleet.revision=fleet.revision.checked_add(1).ok_or_else(|| Failure::new(ErrorCode::Limit,"Fleet revision exceeds native range"))?;fleet.updated_at=now;repo.save_fleet(&fleet)?;
        repo.audit(&audit(actor,request_id,"fleet",id,"fleet.archive",&fleet.owner_id,now))
    })
}
