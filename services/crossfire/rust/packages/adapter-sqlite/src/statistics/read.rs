use super::{add, tokens, totals};
use crate::store::Store;
use crate::{
    error::failure,
    tables::{
        listener_stat_flow as flow, listener_stat_interval as interval,
        listener_stat_usage as usage,
    },
};
use crossfire_domain::statistics::*;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::{
    dsl::{count, count_star, max, min},
    prelude::*,
    sql_types::{BigInt, Nullable},
};
use std::collections::HashMap;

#[diesel::declare_sql_function]
extern "SQL" {
    #[aggregate]
    #[sql_name = "sum"]
    fn sum_integer(value: Nullable<BigInt>) -> Nullable<BigInt>;
}

#[derive(Queryable)]
struct IntervalAggregate {
    intervals: i64,
    dropped: Option<i64>,
    first: Option<i64>,
    last: Option<i64>,
}

#[derive(Queryable)]
struct TrafficAggregate {
    agent_id: String,
    observed: Option<i64>,
    delivered: Option<i64>,
    content_bytes: Option<i64>,
    delivered_bytes: Option<i64>,
    attachment_bytes: Option<i64>,
    largest_bytes: Option<i64>,
}

impl TrafficAggregate {
    fn totals(&self) -> Result<Totals> {
        Ok(Totals {
            observed: add(0, self.observed.unwrap_or(0))?,
            delivered: add(0, self.delivered.unwrap_or(0))?,
            content_bytes: add(0, self.content_bytes.unwrap_or(0))?,
            delivered_bytes: add(0, self.delivered_bytes.unwrap_or(0))?,
            attachment_bytes: add(0, self.attachment_bytes.unwrap_or(0))?,
            largest_bytes: self.largest_bytes.unwrap_or(0),
        })
    }
}

#[derive(Queryable)]
struct FlowAggregate {
    agent_id: String,
    room_id: String,
    sender_backend_user_id: String,
    message_type: String,
    observed: Option<i64>,
    delivered: Option<i64>,
    content_bytes: Option<i64>,
    delivered_bytes: Option<i64>,
    attachment_bytes: Option<i64>,
    largest_bytes: Option<i64>,
}

#[derive(Queryable)]
struct UsageAggregate {
    agent_id: String,
    input: Option<i64>,
    cached_input: Option<i64>,
    cache_write_input: Option<i64>,
    output: Option<i64>,
    reasoning_output: Option<i64>,
    total: Option<i64>,
    rows: i64,
    cache_write_rows: i64,
    reasoning_rows: i64,
}

pub(super) fn read(
    store: &mut Store,
    agent_ids: &[String],
    since: i64,
    page: i64,
    page_size: i64,
) -> Result<Statistics> {
    if !(1..=100_000).contains(&page) || !(1..=100).contains(&page_size) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid statistics pagination",
        ));
    }
    let intervals = interval::table
        .filter(
            interval::agent_id
                .eq_any(agent_ids)
                .and(interval::captured_at.ge(since)),
        )
        .group_by(interval::agent_id)
        .select((
            count_star(),
            sum_integer(interval::dropped.nullable()),
            min(interval::captured_at),
            max(interval::captured_at),
        ))
        .load::<IntervalAggregate>(store.database.connection())
        .map_err(failure)?;
    let flow_source = flow::table.inner_join(
        interval::table.on(flow::run_id
            .eq(interval::run_id)
            .and(flow::bucket_at.eq(interval::bucket_at))),
    );
    let selected = interval::agent_id
        .eq_any(agent_ids)
        .and(interval::captured_at.ge(since));
    let keys = (
        interval::agent_id,
        flow::room_id,
        flow::sender_backend_user_id,
        flow::message_type,
    );
    let flows = flow_source
        .filter(selected.clone())
        .group_by(keys)
        .select((
            interval::agent_id,
            flow::room_id,
            flow::sender_backend_user_id,
            flow::message_type,
            sum_integer(flow::observed.nullable()),
            sum_integer(flow::delivered.nullable()),
            sum_integer(flow::content_bytes.nullable()),
            sum_integer(flow::delivered_bytes.nullable()),
            sum_integer(flow::attachment_bytes.nullable()),
            max(flow::largest_bytes),
        ))
        .order((
            sum_integer(flow::observed.nullable()).desc(),
            flow::sender_backend_user_id.asc(),
            interval::agent_id.asc(),
            flow::room_id.asc(),
            flow::message_type.asc(),
        ))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .load::<FlowAggregate>(store.database.connection())
        .map_err(failure)?;
    let total_flows = flow_source
        .filter(selected.clone())
        .group_by(keys)
        .select(count_star().over())
        .first::<i64>(store.database.connection())
        .optional()
        .map_err(failure)?
        .unwrap_or(0);
    let traffic = flow_source
        .filter(selected.clone())
        .group_by(interval::agent_id)
        .select((
            interval::agent_id,
            sum_integer(flow::observed.nullable()),
            sum_integer(flow::delivered.nullable()),
            sum_integer(flow::content_bytes.nullable()),
            sum_integer(flow::delivered_bytes.nullable()),
            sum_integer(flow::attachment_bytes.nullable()),
            max(flow::largest_bytes),
        ))
        .load::<TrafficAggregate>(store.database.connection())
        .map_err(failure)?;
    let usage = usage::table
        .inner_join(
            interval::table.on(usage::run_id
                .eq(interval::run_id)
                .and(usage::bucket_at.eq(interval::bucket_at))),
        )
        .filter(selected)
        .group_by(interval::agent_id)
        .select((
            interval::agent_id,
            sum_integer(usage::input.nullable()),
            sum_integer(usage::cached_input.nullable()),
            sum_integer(usage::cache_write_input),
            sum_integer(usage::output.nullable()),
            sum_integer(usage::reasoning_output),
            sum_integer(usage::total.nullable()),
            count_star(),
            count(usage::cache_write_input),
            count(usage::reasoning_output),
        ))
        .load::<UsageAggregate>(store.database.connection())
        .map_err(failure)?;
    let mut agents: Vec<_> = agent_ids
        .iter()
        .map(|id| AgentStatistics {
            agent_id: id.clone(),
            totals: Totals::default(),
            tokens: None,
        })
        .collect();
    let positions: HashMap<&str, usize> = agent_ids
        .iter()
        .enumerate()
        .map(|(position, id)| (id.as_str(), position))
        .collect();
    let mut all_totals = Totals::default();
    for aggregate in traffic {
        let measured = aggregate.totals()?;
        all_totals = totals(&all_totals, &measured)?;
        if let Some(position) = positions.get(aggregate.agent_id.as_str()) {
            agents[*position].totals = measured;
        }
    }
    let mut all_tokens = if usage.is_empty() {
        None
    } else {
        Some(Tokens {
            cache_write_input: Some(0),
            reasoning_output: Some(0),
            ..Tokens::default()
        })
    };
    for aggregate in usage {
        let counts = Tokens {
            input: add(0, aggregate.input.unwrap_or(0))?,
            cached_input: add(0, aggregate.cached_input.unwrap_or(0))?,
            cache_write_input: if aggregate.cache_write_rows == aggregate.rows {
                Some(add(0, aggregate.cache_write_input.unwrap_or(0))?)
            } else {
                None
            },
            output: add(0, aggregate.output.unwrap_or(0))?,
            reasoning_output: if aggregate.reasoning_rows == aggregate.rows {
                Some(add(0, aggregate.reasoning_output.unwrap_or(0))?)
            } else {
                None
            },
            total: add(0, aggregate.total.unwrap_or(0))?,
        };
        if let Some(total) = &mut all_tokens {
            *total = tokens(total, &counts)?;
        }
        if let Some(position) = positions.get(aggregate.agent_id.as_str()) {
            agents[*position].tokens = Some(counts);
        }
    }
    let flows = flows
        .into_iter()
        .map(|aggregate| {
            Ok(FlowRecord {
                agent_id: aggregate.agent_id,
                flow: Flow {
                    room_id: aggregate.room_id,
                    sender_backend_user_id: aggregate.sender_backend_user_id,
                    message_type: aggregate.message_type,
                    totals: Totals {
                        observed: add(0, aggregate.observed.unwrap_or(0))?,
                        delivered: add(0, aggregate.delivered.unwrap_or(0))?,
                        content_bytes: add(0, aggregate.content_bytes.unwrap_or(0))?,
                        delivered_bytes: add(0, aggregate.delivered_bytes.unwrap_or(0))?,
                        attachment_bytes: add(0, aggregate.attachment_bytes.unwrap_or(0))?,
                        largest_bytes: aggregate.largest_bytes.unwrap_or(0),
                    },
                },
            })
        })
        .collect::<Result<Vec<_>>>()?;
    let total_intervals = intervals
        .iter()
        .try_fold(0, |total, value| add(total, value.intervals))?;
    let dropped = intervals
        .iter()
        .try_fold(0, |total, value| add(total, value.dropped.unwrap_or(0)))?;
    Ok(Statistics {
        intervals: total_intervals,
        dropped,
        first_report_at: intervals.iter().filter_map(|value| value.first).min(),
        last_report_at: intervals.iter().filter_map(|value| value.last).max(),
        totals: all_totals,
        agents,
        flows,
        total_flows,
        tokens: all_tokens,
    })
}
