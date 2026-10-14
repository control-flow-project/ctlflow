use crate::{
    authorization::authorize,
    fleet::values::{Connection, Credential, Fleet},
    identity::{Actor, Status},
    permission::Permission,
    port::ListenerRepository,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};

pub const HEARTBEAT_INTERVAL_MS: i64 = 30_000;
pub const HEARTBEAT_EXPIRY_MS: i64 = 90_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Run {
    pub id: String,
    pub agent_id: String,
    pub controller: Option<Controller>,
    pub release: Option<String>,
    pub started_at: i64,
    pub last_seen_at: i64,
    pub active_ms: i64,
    pub messages_delivered: i64,
    pub stopped_at: Option<i64>,
    pub disconnect_requested_at: Option<i64>,
}

pub struct Proof {
    pub fleet_id: String,
    pub connection_id: String,
    pub credential: Secret,
}

pub struct Report {
    pub run_id: String,
    pub release: String,
    pub messages_delivered: i64,
    pub stopped: bool,
    pub statistics: Option<crate::statistics::Batch>,
    pub controller: Proof,
}

pub struct ReportOutcome {
    pub disconnect: bool,
    pub closed: bool,
    pub current_release: String,
    pub statistics_accepted: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Controller {
    pub fleet_id: String,
    pub connection_id: String,
    pub credential_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    pub owner_id: String,
    pub fleet_key: String,
    pub retired_at: Option<i64>,
}

pub struct AdmissionFacts {
    pub binding: Binding,
    pub fleet: Fleet,
    pub connection: Connection,
    pub credential: Credential,
    pub owner_status: Status,
}

pub fn admits_controller(
    controller: Option<&Controller>,
    facts: Option<&AdmissionFacts>,
    now: i64,
) -> bool {
    let (Some(controller), Some(facts)) = (controller, facts) else {
        return false;
    };
    facts.owner_status == Status::Active
        && facts.binding.retired_at.is_none()
        && facts.fleet.archived_at.is_none()
        && facts.binding.owner_id == facts.fleet.owner_id
        && facts.binding.fleet_key == facts.fleet.fleet_key
        && facts.fleet.id == controller.fleet_id
        && facts.fleet.delivery_enabled
        && facts.connection.connection_id == controller.connection_id
        && facts.connection.credential_id == controller.credential_id
        && facts.connection.closed_at.is_none()
        && facts.connection.expires_at > now
        && facts.credential.fleet_id == facts.fleet.id
        && facts.credential.revoked_at.is_none()
}

pub fn controller_proof(
    repo: &mut impl ListenerRepository,
    id: &str,
    proof: &Proof,
) -> Result<Controller> {
    let crate::fleet::values::FleetActor::Controller {
        fleet_id,
        credential_id,
    } = crate::fleet::authority::authenticate_controller(repo, &proof.credential)?
    else {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "A verified fleet controller connection is required",
        ));
    };
    if fleet_id != proof.fleet_id {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Controller authority belongs to another fleet",
        ));
    }
    let binding = repo.fleet_instance_by_agent(id)?;
    let fleet = repo.fleet(&proof.fleet_id)?;
    let (Some(binding), Some(fleet)) = (binding, fleet) else {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Controller authority does not cover this agent",
        ));
    };
    if binding.retired_at.is_some()
        || fleet.archived_at.is_some()
        || binding.owner_id != fleet.owner_id
        || binding.fleet_key != fleet.fleet_key
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Controller authority does not cover this agent",
        ));
    }
    Ok(Controller {
        fleet_id,
        connection_id: proof.connection_id.clone(),
        credential_id,
    })
}

pub fn controller_admission(
    repo: &mut impl ListenerRepository,
    id: &str,
    controller: Option<&Controller>,
    now: i64,
) -> Result<bool> {
    let Some(controller) = controller else {
        return Ok(false);
    };
    let binding = repo.fleet_instance_by_agent(id)?;
    let fleet = repo.fleet(&controller.fleet_id)?;
    let connection = repo.fleet_connection(&controller.fleet_id)?;
    let credential = repo.fleet_credential(&controller.credential_id)?;
    let owner = match &fleet {
        Some(fleet) => repo.principal(&fleet.owner_id)?,
        None => None,
    };
    let (Some(binding), Some(fleet), Some(connection), Some(credential), Some(owner)) =
        (binding, fleet, connection, credential, owner)
    else {
        return Ok(false);
    };
    Ok(admits_controller(
        Some(controller),
        Some(&AdmissionFacts {
            binding: Binding {
                owner_id: binding.owner_id,
                fleet_key: binding.fleet_key,
                retired_at: binding.retired_at,
            },
            fleet,
            connection,
            credential,
            owner_status: owner.status,
        }),
        now,
    ))
}

pub fn report(
    repo: &mut impl ListenerRepository,
    actor: &Actor,
    id: &str,
    input: &Report,
    current_release: &str,
    now: i64,
) -> Result<ReportOutcome> {
    if input.run_id.len() != 36
        || !input
            .run_id
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value) || value == b'-')
        || input.release.is_empty()
        || input.release.encode_utf16().count() > 200
        || input.messages_delivered < 0
        || input.messages_delivered > 9_007_199_254_740_991
    {
        return Err(Failure::new(ErrorCode::Invalid, "Invalid listener report"));
    }
    let mut outcome = repo.transaction(|repo| {
        authorize(repo, actor, Permission::ListenerReportSelf, now)?;
        if actor.principal_id != id { return Err(Failure::new(ErrorCode::Missing, "Listener agent not found")); }
        let controller = controller_proof(repo, id, &input.controller)?;
        let previous = repo.listener_run(&input.run_id)?;
        if previous.as_ref().is_some_and(|run| run.agent_id != id) { return Err(Failure::new(ErrorCode::Missing, "Listener run not found")); }
        if previous.as_ref().is_some_and(|run| run.stopped_at.is_some()) {
            return Ok(ReportOutcome { disconnect: true, current_release: current_release.to_owned(), closed: true, statistics_accepted: false });
        }
        if previous.as_ref().is_some_and(|run| run.release.as_deref() != Some(input.release.as_str())) { return Err(Failure::new(ErrorCode::Conflict, "A running listener cannot change its software version")); }
        if previous.as_ref().is_some_and(|run| run.controller.as_ref() != Some(&controller)) { return Err(Failure::new(ErrorCode::Conflict, "A listener run cannot change its controller generation")); }
        if previous.is_none() && input.release != current_release { return Err(Failure::new(ErrorCode::Conflict, format!("Update the project-local Crossfire client and skill before reconnecting. Current release: {current_release}"))); }
        let admitted = controller_admission(repo, id, Some(&controller), now)?;
        if previous.is_none() && !admitted { return Err(Failure::new(ErrorCode::Conflict, "An active authenticated controller lease and delivery intent are required")); }
        let elapsed = previous.as_ref().map_or(0, |run| now.saturating_sub(run.last_seen_at).max(0));
        let active_ms = previous.as_ref().map_or(0, |run| run.active_ms).checked_add(if elapsed <= HEARTBEAT_EXPIRY_MS { elapsed } else { 0 })
            .filter(|value| *value <= 9_007_199_254_740_991).ok_or_else(|| Failure::new(ErrorCode::Limit, "Listener active duration exceeds the exact integer range"))?;
        let run = Run { id: input.run_id.clone(), agent_id: id.to_owned(), controller: Some(controller), release: Some(input.release.clone()),
            started_at: previous.as_ref().map_or(now, |run| run.started_at), last_seen_at: previous.as_ref().map_or(now, |run| now.max(run.last_seen_at)), active_ms,
            messages_delivered: previous.as_ref().map_or(input.messages_delivered, |run| run.messages_delivered.max(input.messages_delivered)), stopped_at: input.stopped.then_some(now),
            disconnect_requested_at: previous.as_ref().and_then(|run| run.disconnect_requested_at).or_else(|| (!admitted).then_some(now)) };
        if previous.is_none() && repo.active_listener_count(id, now - HEARTBEAT_EXPIRY_MS, now)? >= 100 { return Err(Failure::new(ErrorCode::Limit, "Too many reporting listeners")); }
        repo.save_listener_run(&run, previous.is_none())?;
        Ok(ReportOutcome { disconnect: run.disconnect_requested_at.is_some(), closed: false, current_release: current_release.to_owned(), statistics_accepted: false })
    })?;
    if !outcome.closed {
        outcome.statistics_accepted = match &input.statistics {
            None => true,
            Some(batch) => repo
                .transaction(|repo| repo.record_statistics(id, &input.run_id, batch, now))
                .is_ok(),
        };
    }
    Ok(outcome)
}
