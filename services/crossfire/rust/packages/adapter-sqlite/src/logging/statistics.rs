use crate::store::Store;
use crate::{
    error::failure,
    tables::{listener_stat_checkpoint, listener_stat_interval, runtime_usage_checkpoint},
};
use crossfire_kernel::Result;
use diesel::prelude::*;

pub(super) fn prune(store: &mut Store, cutoff: i64, limit: i64) -> Result<Vec<usize>> {
    let intervals = listener_stat_interval::table
        .filter(listener_stat_interval::captured_at.lt(cutoff))
        .order(listener_stat_interval::captured_at.asc())
        .limit(limit)
        .select((
            listener_stat_interval::run_id,
            listener_stat_interval::bucket_at,
        ))
        .load::<(String, i64)>(store.database.connection())
        .map_err(failure)?;
    for (run, bucket) in &intervals {
        diesel::delete(
            listener_stat_interval::table.filter(
                listener_stat_interval::run_id
                    .eq(run)
                    .and(listener_stat_interval::bucket_at.eq(bucket)),
            ),
        )
        .execute(store.database.connection())
        .map_err(failure)?;
    }
    let checkpoints = listener_stat_checkpoint::table
        .filter(listener_stat_checkpoint::captured_at.lt(cutoff))
        .order(listener_stat_checkpoint::captured_at.asc())
        .limit(limit)
        .select(listener_stat_checkpoint::run_id)
        .load::<String>(store.database.connection())
        .map_err(failure)?;
    diesel::delete(
        listener_stat_checkpoint::table
            .filter(listener_stat_checkpoint::run_id.eq_any(&checkpoints)),
    )
    .execute(store.database.connection())
    .map_err(failure)?;
    let usage = runtime_usage_checkpoint::table
        .filter(runtime_usage_checkpoint::captured_at.lt(cutoff))
        .order(runtime_usage_checkpoint::captured_at.asc())
        .limit(limit)
        .select((
            runtime_usage_checkpoint::agent_id,
            runtime_usage_checkpoint::runtime,
            runtime_usage_checkpoint::session_id,
        ))
        .load::<(String, String, String)>(store.database.connection())
        .map_err(failure)?;
    for (agent, runtime, session) in &usage {
        diesel::delete(
            runtime_usage_checkpoint::table.filter(
                runtime_usage_checkpoint::agent_id
                    .eq(agent)
                    .and(runtime_usage_checkpoint::runtime.eq(runtime))
                    .and(runtime_usage_checkpoint::session_id.eq(session)),
            ),
        )
        .execute(store.database.connection())
        .map_err(failure)?;
    }
    Ok(vec![intervals.len(), checkpoints.len(), usage.len()])
}
