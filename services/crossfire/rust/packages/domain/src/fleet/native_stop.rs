use super::{
    control::live_connection,
    values::{Connection, Credential, FleetActor},
};
use crate::{
    listener::Run,
    port::{AgentRepository, ListenerRepository},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativeStop {
    pub agent_id: String,
    pub receipt_id: String,
    pub sequence: i64,
    pub fleet_id: String,
    pub run_id: String,
    pub connection_id: String,
    pub credential_id: String,
    pub native_stopped_at: i64,
    pub invalidated_at: Option<i64>,
}
pub enum Selection<'a> {
    Agents(&'a [String]),
    Fleets(&'a [String]),
}
pub struct RetirementAgent {
    pub agent_id: String,
    pub fleet_id: String,
    pub owner_active: bool,
    pub pending_operation: bool,
    pub pending_decision: bool,
    pub pending_wake: bool,
    pub pending_broadcast: bool,
    pub has_observed_runtime: bool,
    pub latest_run: Option<Run>,
    pub latest_active_observation_at: Option<i64>,
    pub native_stop: Option<NativeStop>,
    pub controller: Option<(Connection, Option<Credential>)>,
}
pub struct Snapshot {
    pub agents: Vec<RetirementAgent>,
    pub pending_fleet_ids: BTreeSet<String>,
}
pub struct Eligibility {
    pub agents: BTreeMap<String, (String, bool)>,
    pub fleets: BTreeMap<String, bool>,
    pub pending_fleet_ids: BTreeSet<String>,
}
pub trait NativeStopRepository {
    fn native_stop(&mut self, agent: &str) -> Result<Option<NativeStop>>;
    fn native_stop_receipt(&mut self, agent: &str, receipt: &str) -> Result<Option<NativeStop>>;
    fn insert_native_stop(&mut self, value: &NativeStop) -> Result<()>;
    fn invalidate_native_stop(&mut self, agent: &str, now: i64) -> Result<()>;
}
pub trait RetirementRepository:
    ListenerRepository + AgentRepository + NativeStopRepository
{
    fn retirement(&mut self, selection: Selection<'_>, now: i64) -> Result<Snapshot>;
    fn latest_listener(&mut self, agent: &str) -> Result<Option<Run>>;
    fn retire_listener_runs(&mut self, agent: &str, now: i64) -> Result<()>;
    fn revoke_fleet_credentials(&mut self, fleet: &str, now: i64) -> Result<()>;
}
pub fn receipts_settled(agent: &RetirementAgent) -> bool {
    !agent.pending_decision && !agent.pending_wake && !agent.pending_broadcast
}
pub fn can_retire(agent: &RetirementAgent, now: i64) -> bool {
    if agent.pending_operation || !receipts_settled(agent) {
        return false;
    }
    if !agent.has_observed_runtime && agent.latest_run.is_none() {
        return true;
    }
    let (Some(run), Some(proof), Some((controller, credential))) =
        (&agent.latest_run, &agent.native_stop, &agent.controller)
    else {
        return false;
    };
    agent.owner_active
        && run.stopped_at.is_some()
        && proof.invalidated_at.is_none()
        && proof.agent_id == agent.agent_id
        && proof.fleet_id == agent.fleet_id
        && proof.run_id == run.id
        && run.controller.fleet_id == agent.fleet_id
        && run.controller.connection_id == proof.connection_id
        && run.controller.credential_id == proof.credential_id
        && controller.closed_at.is_none()
        && controller.expires_at > now
        && controller.fleet_id == agent.fleet_id
        && controller.connection_id == proof.connection_id
        && controller.credential_id == proof.credential_id
        && credential.as_ref().is_some_and(|credential| {
            credential.id == proof.credential_id
                && credential.fleet_id == agent.fleet_id
                && credential.revoked_at.is_none()
        })
        && agent
            .latest_active_observation_at
            .is_none_or(|at| at <= proof.native_stopped_at)
}
pub fn eligibility(
    repo: &mut impl RetirementRepository,
    selection: Selection<'_>,
    now: i64,
) -> Result<Eligibility> {
    let mut fleets = if let Selection::Fleets(ids) = &selection {
        ids.iter()
            .map(|id| (id.clone(), true))
            .collect::<BTreeMap<_, _>>()
    } else {
        BTreeMap::new()
    };
    let snapshot = repo.retirement(selection, now)?;
    for (fleet, eligible) in &mut fleets {
        *eligible = !snapshot.pending_fleet_ids.contains(fleet);
    }
    let mut agents = BTreeMap::new();
    for agent in snapshot.agents {
        let eligible = can_retire(&agent, now);
        agents.insert(agent.agent_id, (agent.fleet_id.clone(), eligible));
        let fleet = fleets
            .entry(agent.fleet_id.clone())
            .or_insert_with(|| !snapshot.pending_fleet_ids.contains(&agent.fleet_id));
        *fleet &= eligible;
    }
    Ok(Eligibility {
        agents,
        fleets,
        pending_fleet_ids: snapshot.pending_fleet_ids,
    })
}
pub struct StopInput<'a> {
    pub fleet: &'a str,
    pub agent: &'a str,
    pub connection: &'a str,
    pub run: &'a str,
    pub receipt: &'a str,
}
pub fn record(
    repo: &mut impl RetirementRepository,
    actor: &FleetActor,
    input: StopInput<'_>,
    now: i64,
) -> Result<()> {
    repo.transaction(|repo| {
        let (fleet, connection) = live_connection(repo, actor, input.fleet, input.connection, now)?;
        repo.fleet_instance_by_agent(input.agent)?
            .filter(|binding| {
                binding.retired_at.is_none()
                    && binding.owner_id == fleet.owner_id
                    && binding.fleet_key == fleet.fleet_key
            })
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Forbidden,
                    "Native stop proof must cover this current fleet instance",
                )
            })?;
        let run = repo
            .listener_run(input.run)?
            .filter(|run| {
                run.agent_id == input.agent
                    && run.controller.fleet_id == input.fleet
                    && run.controller.connection_id == input.connection
                    && run.controller.credential_id == connection.credential_id
            })
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Conflict,
                    "Native stop proof requires the current authenticated listener generation",
                )
            })?;
        if run.stopped_at.is_none() {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Stop delivery for this listener generation before recording native close",
            ));
        }
        if repo
            .latest_listener(input.agent)?
            .is_none_or(|latest| latest.id != input.run)
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Native stop proof must cover the latest listener run",
            ));
        }
        if let Some(previous) = repo.native_stop_receipt(input.agent, input.receipt)? {
            return if previous.run_id == input.run
                && previous.connection_id == input.connection
                && previous.credential_id == connection.credential_id
                && previous.invalidated_at.is_none()
            {
                Ok(())
            } else {
                Err(Failure::new(
                    ErrorCode::Conflict,
                    "This native stop receipt is obsolete or belongs to another generation",
                ))
            };
        }
        let ids = [input.agent.to_owned()];
        if repo
            .retirement(Selection::Agents(&ids), now)?
            .agents
            .iter()
            .find(|agent| agent.agent_id == input.agent)
            .is_none_or(|agent| !receipts_settled(agent))
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Settle native decisions and wake receipts before reporting a native stop",
            ));
        }
        let sequence = repo
            .native_stop(input.agent)?
            .map_or(0, |proof| proof.sequence)
            .checked_add(1)
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Limit,
                    "Native stop sequence exceeds native range",
                )
            })?;
        repo.insert_native_stop(&NativeStop {
            agent_id: input.agent.to_owned(),
            receipt_id: input.receipt.to_owned(),
            sequence,
            fleet_id: input.fleet.to_owned(),
            run_id: input.run.to_owned(),
            connection_id: input.connection.to_owned(),
            credential_id: connection.credential_id,
            native_stopped_at: now,
            invalidated_at: None,
        })
    })
}
