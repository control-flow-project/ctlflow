use super::{add, tokens, totals};
use crate::store::Store;
use crate::{
    error::failure,
    tables::{
        listener_stat_checkpoint, listener_stat_flow, listener_stat_interval, listener_stat_usage,
        runtime_usage_checkpoint,
    },
};
use crossfire_contracts::statistics::BatchWire;
use crossfire_domain::statistics::{Batch, Flow, Tokens, Totals, Usage};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use diesel::prelude::*;

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = listener_stat_interval)]
struct IntervalRow {
    run_id: String,
    bucket_at: i64,
    agent_id: String,
    started_at: i64,
    ended_at: i64,
    captured_at: i64,
    dropped: i64,
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = listener_stat_flow)]
struct FlowRow {
    run_id: String,
    bucket_at: i64,
    room_id: String,
    sender_matrix_id: String,
    message_type: String,
    observed: i64,
    delivered: i64,
    content_bytes: i64,
    delivered_bytes: i64,
    attachment_bytes: i64,
    largest_bytes: i64,
}

impl FlowRow {
    fn totals(&self) -> Totals {
        Totals {
            observed: self.observed,
            delivered: self.delivered,
            content_bytes: self.content_bytes,
            delivered_bytes: self.delivered_bytes,
            attachment_bytes: self.attachment_bytes,
            largest_bytes: self.largest_bytes,
        }
    }
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = listener_stat_usage, treat_none_as_null = true)]
struct UsageRow {
    run_id: String,
    bucket_at: i64,
    runtime: String,
    session_id: String,
    input: i64,
    cached_input: i64,
    cache_write_input: Option<i64>,
    output: i64,
    reasoning_output: Option<i64>,
    total: i64,
}

impl UsageRow {
    fn tokens(&self) -> Tokens {
        Tokens {
            input: self.input,
            cached_input: self.cached_input,
            cache_write_input: self.cache_write_input,
            output: self.output,
            reasoning_output: self.reasoning_output,
            total: self.total,
        }
    }
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = runtime_usage_checkpoint, treat_none_as_null = true)]
struct UsageCheckpoint {
    agent_id: String,
    runtime: String,
    session_id: String,
    input: i64,
    cached_input: i64,
    cache_write_input: Option<i64>,
    output: i64,
    reasoning_output: Option<i64>,
    total: i64,
    captured_at: i64,
}

fn difference(value: &Tokens, previous: Option<&UsageCheckpoint>) -> Result<Option<Tokens>> {
    if let Some(previous) = previous
        && [
            previous.input,
            previous.cached_input,
            previous.cache_write_input.unwrap_or(0),
            previous.output,
            previous.reasoning_output.unwrap_or(0),
            previous.total,
        ]
        .into_iter()
        .any(|value| value < 0)
    {
        return Err(Failure::new(
            ErrorCode::Unavailable,
            "Stored usage checkpoint counters are invalid",
        ));
    }
    if let Some(previous) = previous
        && (value.input < previous.input
            || value.cached_input < previous.cached_input
            || value.output < previous.output
            || value.total < previous.total
            || matches!((value.cache_write_input, previous.cache_write_input), (Some(value), Some(before)) if value < before)
            || matches!((value.reasoning_output, previous.reasoning_output), (Some(value), Some(before)) if value < before))
    {
        return Ok(None);
    }
    Ok(Some(Tokens {
        input: previous.map_or(0, |before| value.input - before.input),
        cached_input: previous.map_or(0, |before| value.cached_input - before.cached_input),
        cache_write_input: match (previous, value.cache_write_input) {
            (Some(before), Some(value)) => before.cache_write_input.map(|before| value - before),
            _ => None,
        },
        output: previous.map_or(0, |before| value.output - before.output),
        reasoning_output: value.reasoning_output.and_then(|value| match previous {
            Some(before) => before.reasoning_output.map(|before| value - before),
            None => Some(0),
        }),
        total: previous.map_or(0, |before| value.total - before.total),
    }))
}

fn record_flow(store: &mut Store, run_id: &str, bucket_at: i64, flow: &Flow) -> Result<()> {
    let previous = listener_stat_flow::table
        .filter(
            listener_stat_flow::run_id
                .eq(run_id)
                .and(listener_stat_flow::bucket_at.eq(bucket_at))
                .and(listener_stat_flow::room_id.eq(&flow.room_id))
                .and(listener_stat_flow::sender_matrix_id.eq(&flow.sender_matrix_id))
                .and(listener_stat_flow::message_type.eq(&flow.message_type)),
        )
        .select(FlowRow::as_select())
        .first::<FlowRow>(store.database.connection())
        .optional()
        .map_err(failure)?;
    let counts = totals(
        &previous
            .as_ref()
            .map_or_else(Totals::default, FlowRow::totals),
        &flow.totals,
    )?;
    let row = FlowRow {
        run_id: run_id.to_owned(),
        bucket_at,
        room_id: flow.room_id.clone(),
        sender_matrix_id: flow.sender_matrix_id.clone(),
        message_type: flow.message_type.clone(),
        observed: counts.observed,
        delivered: counts.delivered,
        content_bytes: counts.content_bytes,
        delivered_bytes: counts.delivered_bytes,
        attachment_bytes: counts.attachment_bytes,
        largest_bytes: counts.largest_bytes,
    };
    diesel::insert_into(listener_stat_flow::table)
        .values(&row)
        .on_conflict((
            listener_stat_flow::run_id,
            listener_stat_flow::bucket_at,
            listener_stat_flow::room_id,
            listener_stat_flow::sender_matrix_id,
            listener_stat_flow::message_type,
        ))
        .do_update()
        .set(&row)
        .execute(store.database.connection())
        .map_err(failure)?;
    Ok(())
}

fn record_usage(
    store: &mut Store,
    agent_id: &str,
    run_id: &str,
    bucket_at: i64,
    sample: &Usage,
    now: i64,
) -> Result<bool> {
    let previous = runtime_usage_checkpoint::table
        .filter(
            runtime_usage_checkpoint::agent_id
                .eq(agent_id)
                .and(runtime_usage_checkpoint::runtime.eq(&sample.runtime))
                .and(runtime_usage_checkpoint::session_id.eq(&sample.session_id)),
        )
        .select(UsageCheckpoint::as_select())
        .first::<UsageCheckpoint>(store.database.connection())
        .optional()
        .map_err(failure)?;
    let Some(difference) = difference(&sample.tokens, previous.as_ref())? else {
        return Ok(false);
    };
    let existing = listener_stat_usage::table
        .filter(
            listener_stat_usage::run_id
                .eq(run_id)
                .and(listener_stat_usage::bucket_at.eq(bucket_at))
                .and(listener_stat_usage::runtime.eq(&sample.runtime))
                .and(listener_stat_usage::session_id.eq(&sample.session_id)),
        )
        .select(UsageRow::as_select())
        .first::<UsageRow>(store.database.connection())
        .optional()
        .map_err(failure)?;
    let counts = match existing {
        Some(value) => tokens(&value.tokens(), &difference)?,
        None => difference,
    };
    let row = UsageRow {
        run_id: run_id.to_owned(),
        bucket_at,
        runtime: sample.runtime.clone(),
        session_id: sample.session_id.clone(),
        input: counts.input,
        cached_input: counts.cached_input,
        cache_write_input: counts.cache_write_input,
        output: counts.output,
        reasoning_output: counts.reasoning_output,
        total: counts.total,
    };
    diesel::insert_into(listener_stat_usage::table)
        .values(&row)
        .on_conflict((
            listener_stat_usage::run_id,
            listener_stat_usage::bucket_at,
            listener_stat_usage::runtime,
            listener_stat_usage::session_id,
        ))
        .do_update()
        .set(&row)
        .execute(store.database.connection())
        .map_err(failure)?;
    let counts = &sample.tokens;
    let row = UsageCheckpoint {
        agent_id: agent_id.to_owned(),
        runtime: sample.runtime.clone(),
        session_id: sample.session_id.clone(),
        input: counts.input,
        cached_input: counts.cached_input,
        cache_write_input: counts.cache_write_input,
        output: counts.output,
        reasoning_output: counts.reasoning_output,
        total: counts.total,
        captured_at: now,
    };
    diesel::insert_into(runtime_usage_checkpoint::table)
        .values(&row)
        .on_conflict((
            runtime_usage_checkpoint::agent_id,
            runtime_usage_checkpoint::runtime,
            runtime_usage_checkpoint::session_id,
        ))
        .do_update()
        .set(&row)
        .execute(store.database.connection())
        .map_err(failure)?;
    Ok(true)
}

pub(super) fn record(
    store: &mut Store,
    agent_id: &str,
    run_id: &str,
    batch: &Batch,
    now: i64,
) -> Result<()> {
    let content = serde_json::to_string(&BatchWire(batch))
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid statistics serialization"))?;
    let digest = identity::hash(&content);
    let checkpoint = listener_stat_checkpoint::table
        .filter(listener_stat_checkpoint::run_id.eq(run_id))
        .select((
            listener_stat_checkpoint::sequence,
            listener_stat_checkpoint::digest,
        ))
        .first::<(i64, String)>(store.database.connection())
        .optional()
        .map_err(failure)?;
    if let Some((sequence, previous)) = checkpoint
        && batch.sequence <= sequence
    {
        return if sequence == batch.sequence && previous == digest {
            Ok(())
        } else {
            Err(Failure::new(
                ErrorCode::Conflict,
                "Statistics sequence is stale or has different content",
            ))
        };
    }
    let bucket_at = now.div_euclid(3_600_000) * 3_600_000;
    let previous = listener_stat_interval::table
        .filter(
            listener_stat_interval::run_id
                .eq(run_id)
                .and(listener_stat_interval::bucket_at.eq(bucket_at)),
        )
        .select(IntervalRow::as_select())
        .first::<IntervalRow>(store.database.connection())
        .optional()
        .map_err(failure)?;
    if previous
        .as_ref()
        .is_some_and(|value| value.agent_id != agent_id)
    {
        return Err(Failure::new(
            ErrorCode::Conflict,
            "Statistics belong to another agent",
        ));
    }
    let mut row = IntervalRow {
        run_id: run_id.to_owned(),
        bucket_at,
        agent_id: agent_id.to_owned(),
        started_at: previous.as_ref().map_or(batch.started_at, |value| {
            value.started_at.min(batch.started_at)
        }),
        ended_at: previous
            .as_ref()
            .map_or(batch.ended_at, |value| value.ended_at.max(batch.ended_at)),
        captured_at: now,
        dropped: previous.as_ref().map_or(0, |value| value.dropped),
    };
    if previous.is_none() {
        diesel::insert_into(listener_stat_interval::table)
            .values(&row)
            .execute(store.database.connection())
            .map_err(failure)?;
    }
    let mut dropped = batch.dropped;
    for flow in &batch.flows {
        record_flow(store, run_id, bucket_at, flow)?;
    }
    for sample in &batch.usage {
        if !record_usage(store, agent_id, run_id, bucket_at, sample, now)? {
            dropped = add(dropped, 1)?;
        }
    }
    row.dropped = add(row.dropped, dropped)?;
    diesel::update(
        listener_stat_interval::table.filter(
            listener_stat_interval::run_id
                .eq(run_id)
                .and(listener_stat_interval::bucket_at.eq(bucket_at)),
        ),
    )
    .set(&row)
    .execute(store.database.connection())
    .map_err(failure)?;
    diesel::insert_into(listener_stat_checkpoint::table)
        .values((
            listener_stat_checkpoint::run_id.eq(run_id),
            listener_stat_checkpoint::sequence.eq(batch.sequence),
            listener_stat_checkpoint::digest.eq(&digest),
            listener_stat_checkpoint::captured_at.eq(now),
        ))
        .on_conflict(listener_stat_checkpoint::run_id)
        .do_update()
        .set((
            listener_stat_checkpoint::sequence.eq(batch.sequence),
            listener_stat_checkpoint::digest.eq(&digest),
            listener_stat_checkpoint::captured_at.eq(now),
        ))
        .execute(store.database.connection())
        .map_err(failure)?;
    Ok(())
}
