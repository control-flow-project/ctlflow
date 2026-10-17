use super::{Row, validate_selection};
use crate::{
    error::failure,
    fleet::ConnectionRow,
    listener::ListenerRow,
    store::Store,
    tables::{
        fleet, fleet_connection as connection, fleet_credential as credential,
        fleet_instance as instance, fleet_message as message, fleet_message_delivery as delivery,
        fleet_native_stop as proof, fleet_runtime_operation as operation, listener_run as run,
        principal, runtime_decision as decision, runtime_observation as observation,
        wake_delivery as wake,
    },
};
use crossfire_domain::{
    fleet::{
        native_stop::{NativeStop, RetirementAgent, Selection, Snapshot},
        values::{Connection, Credential},
    },
    listener::Run,
};
use crossfire_kernel::Result;
use diesel::{
    dsl::{exists, max, not},
    prelude::*,
};
use std::collections::{BTreeMap, BTreeSet};
pub(super) fn read(store: &mut Store, selection: Selection<'_>, now: i64) -> Result<Snapshot> {
    validate_selection(&selection)?;
    let mut members = instance::table
        .inner_join(
            fleet::table.on(fleet::owner_id
                .eq(instance::owner_id)
                .and(fleet::fleet_key.eq(instance::fleet_key))),
        )
        .inner_join(principal::table.on(principal::id.eq(instance::owner_id)))
        .filter(
            instance::retired_at
                .is_null()
                .and(fleet::archived_at.is_null()),
        )
        .into_boxed();
    members = match &selection {
        Selection::Agents(ids) => members.filter(instance::agent_id.eq_any(*ids)),
        Selection::Fleets(ids) => members.filter(fleet::id.eq_any(*ids)),
    };
    let members = members
        .select((
            instance::agent_id,
            fleet::id,
            principal::status.eq("active"),
        ))
        .load::<(String, String, bool)>(store.database.connection())
        .map_err(failure)?;
    let ids = members
        .iter()
        .map(|(id, _, _)| id.as_str())
        .collect::<Vec<_>>();
    let mut fleets = members
        .iter()
        .map(|(_, id, _)| id.clone())
        .collect::<BTreeSet<_>>();
    if let Selection::Fleets(ids) = selection {
        fleets.extend(ids.iter().cloned());
    }
    let fleets = fleets.into_iter().collect::<Vec<_>>();
    let pending_fleet_ids = operation::table
        .filter(
            operation::fleet_id
                .eq_any(&fleets)
                .and(operation::status.eq_any(["pending", "running"])),
        )
        .select(operation::fleet_id)
        .distinct()
        .load::<String>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .collect::<BTreeSet<_>>();
    if ids.is_empty() {
        return Ok(Snapshot {
            agents: Vec::new(),
            pending_fleet_ids,
        });
    }
    let later = diesel::alias!(run as later);
    let newer = later.filter(
        later.field(run::agent_id).eq(run::agent_id).and(
            later.field(run::started_at).gt(run::started_at).or(later
                .field(run::started_at)
                .eq(run::started_at)
                .and(later.field(run::id).gt(run::id))),
        ),
    );
    let runs = run::table
        .filter(run::agent_id.eq_any(&ids).and(not(exists(newer))))
        .select(ListenerRow::as_select())
        .load::<ListenerRow>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(Run::try_from)
        .collect::<Result<Vec<_>>>()?;
    let run_ids = runs.iter().map(|run| run.id.clone()).collect::<Vec<_>>();
    let runs = runs
        .into_iter()
        .map(|run| (run.agent_id.clone(), run))
        .collect::<BTreeMap<_, _>>();
    let newer = diesel::alias!(proof as newer_proof);
    let newer_proof = newer.filter(
        newer
            .field(proof::agent_id)
            .eq(proof::agent_id)
            .and(newer.field(proof::sequence).gt(proof::sequence)),
    );
    let proofs = proof::table
        .filter(proof::agent_id.eq_any(&ids).and(not(exists(newer_proof))))
        .select(Row::as_select())
        .load::<Row>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(|row| (row.agent_id.clone(), NativeStop::from(row)))
        .collect::<BTreeMap<_, _>>();
    let observed = observation::table
        .filter(observation::agent_id.eq_any(&ids))
        .select(observation::agent_id)
        .distinct()
        .load::<String>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .collect::<BTreeSet<_>>();
    let active = observation::table
        .filter(
            observation::run_id
                .eq_any(&run_ids)
                .and(observation::state.ne_all(["sleeping", "unavailable"])),
        )
        .group_by(observation::agent_id)
        .select((observation::agent_id, max(observation::observed_at)))
        .load::<(String, Option<i64>)>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .collect::<BTreeMap<_, _>>();
    let decisions = decision::table
        .filter(
            decision::agent_id
                .eq_any(&ids)
                .and(decision::status.eq_any(["pending", "answered"])),
        )
        .select(decision::agent_id)
        .distinct()
        .load::<String>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .collect::<BTreeSet<_>>();
    let wakes = wake::table
        .filter(wake::agent_id.eq_any(&ids).and(wake::status.eq("pending")))
        .select(wake::agent_id)
        .distinct()
        .load::<String>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .collect::<BTreeSet<_>>();
    let broadcasts = delivery::table
        .inner_join(message::table.on(message::id.eq(delivery::message_id)))
        .filter(
            delivery::agent_id
                .eq_any(&ids)
                .and(delivery::status.eq("pending"))
                .and(message::expires_at.gt(now)),
        )
        .select(delivery::agent_id)
        .distinct()
        .load::<String>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .collect::<BTreeSet<_>>();
    let controllers = connection::table
        .filter(connection::fleet_id.eq_any(&fleets))
        .select(ConnectionRow::as_select())
        .load::<ConnectionRow>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(Connection::from)
        .collect::<Vec<_>>();
    let credential_ids = controllers
        .iter()
        .map(|value| &value.credential_id)
        .collect::<Vec<_>>();
    let credentials = credential::table
        .filter(credential::id.eq_any(&credential_ids))
        .load::<(String, String, String, i64, Option<i64>)>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(|(id, fleet_id, secret_hash, created_at, revoked_at)| {
            (
                id.clone(),
                Credential {
                    id,
                    fleet_id,
                    secret_hash,
                    created_at,
                    revoked_at,
                },
            )
        })
        .collect::<BTreeMap<_, _>>();
    let controllers = controllers
        .into_iter()
        .map(|controller| {
            (
                controller.fleet_id.clone(),
                (
                    controller.clone(),
                    credentials.get(&controller.credential_id).cloned(),
                ),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let agents = members
        .into_iter()
        .map(|(agent_id, fleet_id, owner_active)| RetirementAgent {
            owner_active,
            pending_operation: pending_fleet_ids.contains(&fleet_id),
            pending_decision: decisions.contains(&agent_id),
            pending_wake: wakes.contains(&agent_id),
            pending_broadcast: broadcasts.contains(&agent_id),
            has_observed_runtime: observed.contains(&agent_id),
            latest_run: runs.get(&agent_id).cloned(),
            latest_active_observation_at: active.get(&agent_id).copied().flatten(),
            native_stop: proofs.get(&agent_id).cloned(),
            controller: controllers.get(&fleet_id).cloned(),
            agent_id,
            fleet_id,
        })
        .collect();
    Ok(Snapshot {
        agents,
        pending_fleet_ids,
    })
}
