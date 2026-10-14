use super::{boolean, stored_code};
use crate::store::Store;
use crate::{
    error::failure,
    tables::{fleet_native_stop, fleet_runtime_operation, listener_run, runtime_observation},
};
use crossfire_domain::runtime::values::*;
use crossfire_kernel::Result;
use diesel::{
    dsl::{exists, max, not},
    prelude::*,
};
use std::collections::{BTreeMap, HashMap};

#[derive(Queryable)]
struct Run {
    id: String,
    agent_id: String,
    fleet_id: Option<String>,
    stopped_at: Option<i64>,
}

#[derive(Queryable)]
struct Measurement {
    agent_id: String,
    state: String,
    observed_at: i64,
    last_activity_at: Option<i64>,
    history_available: Option<i64>,
}

pub(super) fn read(store: &mut Store, agent_ids: &[String]) -> Result<BTreeMap<String, Summary>> {
    if agent_ids.is_empty() {
        return Ok(BTreeMap::new());
    }
    let later = diesel::alias!(listener_run as later);
    let newer = later.filter(
        later
            .field(listener_run::agent_id)
            .eq(listener_run::agent_id)
            .and(
                later
                    .field(listener_run::started_at)
                    .gt(listener_run::started_at)
                    .or(later
                        .field(listener_run::started_at)
                        .eq(listener_run::started_at)
                        .and(later.field(listener_run::id).gt(listener_run::id))),
            ),
    );
    let runs = listener_run::table
        .filter(
            listener_run::agent_id
                .eq_any(agent_ids)
                .and(not(exists(newer))),
        )
        .select((
            listener_run::id,
            listener_run::agent_id,
            listener_run::controller_fleet_id,
            listener_run::stopped_at,
        ))
        .load::<Run>(store.database.connection())
        .map_err(failure)?;
    let run_ids: Vec<_> = runs.iter().map(|run| &run.id).collect();
    let rows = runtime_observation::table
        .filter(runtime_observation::run_id.eq_any(&run_ids))
        .select((
            runtime_observation::agent_id,
            runtime_observation::state,
            runtime_observation::observed_at,
            runtime_observation::last_activity_at,
            runtime_observation::history_available,
        ))
        .load::<Measurement>(store.database.connection())
        .map_err(failure)?;
    let mut groups: HashMap<String, Vec<StateMeasurement>> = HashMap::new();
    for row in rows {
        groups
            .entry(row.agent_id)
            .or_default()
            .push(StateMeasurement {
                state: stored_code(State::parse(&row.state))?,
                observed_at: row.observed_at,
                last_activity_at: row.last_activity_at,
                history_available: row.history_available.map(boolean).transpose()?,
            });
    }
    let mut result: BTreeMap<_, _> = groups
        .into_iter()
        .filter_map(|(id, values)| summarize(values).map(|summary| (id, summary)))
        .collect();
    let stopped: Vec<_> = runs.iter().filter(|run| run.stopped_at.is_some()).collect();
    if stopped.is_empty() {
        return Ok(result);
    }
    let ids: Vec<_> = stopped.iter().map(|run| &run.id).collect();
    let proofs = fleet_native_stop::table
        .filter(
            fleet_native_stop::run_id
                .eq_any(&ids)
                .and(fleet_native_stop::invalidated_at.is_null()),
        )
        .group_by(fleet_native_stop::run_id)
        .select((
            fleet_native_stop::run_id,
            max(fleet_native_stop::native_stopped_at),
        ))
        .load::<(String, Option<i64>)>(store.database.connection())
        .map_err(failure)?;
    let proofs: HashMap<_, _> = proofs.into_iter().collect();
    let operations =
        listener_run::table
            .inner_join(
                fleet_runtime_operation::table.on(fleet_runtime_operation::fleet_id
                    .nullable()
                    .eq(listener_run::controller_fleet_id)),
            )
            .filter(
                listener_run::id
                    .eq_any(&ids)
                    .and(fleet_runtime_operation::action.eq("stop"))
                    .and(fleet_runtime_operation::status.eq("succeeded"))
                    .and(fleet_runtime_operation::agent_id.is_null().or(
                        fleet_runtime_operation::agent_id.eq(listener_run::agent_id.nullable()),
                    )),
            )
            .group_by((listener_run::agent_id, listener_run::controller_fleet_id))
            .select((
                listener_run::agent_id,
                listener_run::controller_fleet_id,
                max(fleet_runtime_operation::completed_at),
            ))
            .load::<(String, Option<String>, Option<i64>)>(store.database.connection())
            .map_err(failure)?;
    let operations: HashMap<_, _> = operations
        .into_iter()
        .map(|(agent, fleet, at)| (agent, (fleet, at)))
        .collect();
    for run in stopped {
        let operation = operations
            .get(&run.agent_id)
            .filter(|(fleet, _)| *fleet == run.fleet_id)
            .and_then(|(_, at)| *at)
            .filter(|at| run.stopped_at.is_some_and(|stopped| *at >= stopped));
        let proof = proofs.get(&run.id).copied().flatten();
        if let Some(observed_at) = proof.max(operation) {
            let previous = result.remove(&run.agent_id);
            result.insert(
                run.agent_id.clone(),
                Summary {
                    state: SummaryState::Stopped,
                    observed_at,
                    last_activity_at: previous.as_ref().and_then(|value| value.last_activity_at),
                    history_available: previous.and_then(|value| value.history_available),
                },
            );
        }
    }
    Ok(result)
}
