use super::{ScanResult, scan_result};
use crate::store::Store;
use crate::{error::failure, tables::*};
use crossfire_domain::logging::Cursor;
use crossfire_kernel::Result;
use diesel::{
    dsl::{exists, not},
    prelude::*,
};
use std::collections::HashSet;

pub(super) fn prune(store: &mut Store, cutoff: i64, limit: i64) -> Result<Vec<usize>> {
    let decisions = runtime_decision::table
        .filter(
            runtime_decision::status
                .ne_all(["pending", "answered"])
                .and(runtime_decision::created_at.lt(cutoff)),
        )
        .order((
            runtime_decision::created_at.asc(),
            runtime_decision::id.asc(),
        ))
        .limit(limit)
        .select(runtime_decision::id)
        .load::<String>(store.database.connection())
        .map_err(failure)?;
    diesel::delete(
        runtime_decision_answer::table
            .filter(runtime_decision_answer::decision_id.eq_any(&decisions)),
    )
    .execute(store.database.connection())
    .map_err(failure)?;
    diesel::delete(
        runtime_decision_option::table
            .filter(runtime_decision_option::decision_id.eq_any(&decisions)),
    )
    .execute(store.database.connection())
    .map_err(failure)?;
    diesel::delete(
        runtime_decision_question::table
            .filter(runtime_decision_question::decision_id.eq_any(&decisions)),
    )
    .execute(store.database.connection())
    .map_err(failure)?;
    diesel::delete(runtime_decision::table.filter(runtime_decision::id.eq_any(&decisions)))
        .execute(store.database.connection())
        .map_err(failure)?;
    let pending = incident_notification::table.filter(
        incident_notification::incident_id
            .eq(runtime_incident::id)
            .and(incident_notification::event_id.is_null()),
    );
    let incidents = runtime_incident::table
        .filter(
            runtime_incident::recovered_at
                .lt(cutoff)
                .and(not(exists(pending))),
        )
        .order((
            runtime_incident::recovered_at.asc(),
            runtime_incident::id.asc(),
        ))
        .limit(limit)
        .select(runtime_incident::id)
        .load::<String>(store.database.connection())
        .map_err(failure)?;
    diesel::delete(
        incident_notification::table.filter(incident_notification::incident_id.eq_any(&incidents)),
    )
    .execute(store.database.connection())
    .map_err(failure)?;
    diesel::delete(runtime_incident::table.filter(runtime_incident::id.eq_any(&incidents)))
        .execute(store.database.connection())
        .map_err(failure)?;
    let later = diesel::alias!(fleet_native_stop as later);
    let newer = later.filter(
        later
            .field(fleet_native_stop::agent_id)
            .eq(fleet_native_stop::agent_id)
            .and(
                later
                    .field(fleet_native_stop::sequence)
                    .gt(fleet_native_stop::sequence),
            ),
    );
    let stops = fleet_native_stop::table
        .filter(
            fleet_native_stop::native_stopped_at
                .lt(cutoff)
                .and(exists(newer)),
        )
        .order((
            fleet_native_stop::native_stopped_at.asc(),
            fleet_native_stop::receipt_id.asc(),
        ))
        .limit(limit)
        .select((fleet_native_stop::agent_id, fleet_native_stop::receipt_id))
        .load::<(String, String)>(store.database.connection())
        .map_err(failure)?;
    for (agent, receipt) in &stops {
        diesel::delete(
            fleet_native_stop::table.filter(
                fleet_native_stop::agent_id
                    .eq(agent)
                    .and(fleet_native_stop::receipt_id.eq(receipt)),
            ),
        )
        .execute(store.database.connection())
        .map_err(failure)?;
    }
    Ok(vec![decisions.len(), incidents.len(), stops.len()])
}

pub(super) fn runs(
    store: &mut Store,
    cutoff: i64,
    limit: i64,
    cursor: Option<&Cursor>,
) -> Result<ScanResult> {
    let after = cursor.map_or(-9_007_199_254_740_991, |cursor| cursor.at);
    let id = cursor.map_or("", |cursor| cursor.id.as_str());
    let candidates = listener_run::table
        .filter(
            listener_run::last_seen_at.lt(cutoff).and(
                listener_run::last_seen_at
                    .gt(after)
                    .or(listener_run::last_seen_at
                        .eq(after)
                        .and(listener_run::id.gt(id))),
            ),
        )
        .order((listener_run::last_seen_at.asc(), listener_run::id.asc()))
        .limit(limit)
        .select((
            listener_run::id,
            listener_run::agent_id,
            listener_run::last_seen_at,
        ))
        .load::<(String, String, i64)>(store.database.connection())
        .map_err(failure)?;
    let ids: Vec<_> = candidates.iter().map(|value| value.0.clone()).collect();
    let agents: HashSet<_> = candidates.iter().map(|value| value.1.clone()).collect();
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
    let mut protected: HashSet<_> = listener_run::table
        .filter(
            listener_run::agent_id
                .eq_any(agents)
                .and(not(exists(newer))),
        )
        .select(listener_run::id)
        .load::<String>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .collect();
    protected.extend(
        runtime_decision::table
            .filter(runtime_decision::run_id.eq_any(&ids))
            .select(runtime_decision::run_id)
            .distinct()
            .load::<String>(store.database.connection())
            .map_err(failure)?,
    );
    protected.extend(
        wake_delivery::table
            .filter(wake_delivery::run_id.eq_any(&ids))
            .select(wake_delivery::run_id)
            .distinct()
            .load::<String>(store.database.connection())
            .map_err(failure)?,
    );
    protected.extend(
        fleet_native_stop::table
            .filter(fleet_native_stop::run_id.eq_any(&ids))
            .select(fleet_native_stop::run_id)
            .distinct()
            .load::<String>(store.database.connection())
            .map_err(failure)?,
    );
    protected.extend(
        runtime_incident::table
            .filter(runtime_incident::run_id.eq_any(&ids))
            .select(runtime_incident::run_id)
            .distinct()
            .load::<Option<String>>(store.database.connection())
            .map_err(failure)?
            .into_iter()
            .flatten(),
    );
    protected.extend(
        listener_stat_interval::table
            .filter(listener_stat_interval::run_id.eq_any(&ids))
            .select(listener_stat_interval::run_id)
            .distinct()
            .load::<String>(store.database.connection())
            .map_err(failure)?,
    );
    protected.extend(
        listener_stat_checkpoint::table
            .filter(listener_stat_checkpoint::run_id.eq_any(&ids))
            .select(listener_stat_checkpoint::run_id)
            .distinct()
            .load::<String>(store.database.connection())
            .map_err(failure)?,
    );
    let removable: Vec<_> = ids
        .into_iter()
        .filter(|id| !protected.contains(id))
        .collect();
    diesel::delete(runtime_setting::table.filter(runtime_setting::run_id.eq_any(&removable)))
        .execute(store.database.connection())
        .map_err(failure)?;
    diesel::delete(
        runtime_observation::table.filter(runtime_observation::run_id.eq_any(&removable)),
    )
    .execute(store.database.connection())
    .map_err(failure)?;
    diesel::delete(listener_run::table.filter(listener_run::id.eq_any(&removable)))
        .execute(store.database.connection())
        .map_err(failure)?;
    let scanned: Vec<_> = candidates.into_iter().map(|(id, _, at)| (id, at)).collect();
    Ok(scan_result(&scanned, removable.len(), limit))
}
