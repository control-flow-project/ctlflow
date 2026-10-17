mod read;
mod record;

use crate::store::Store;
use crossfire_domain::statistics::{Batch, Statistics, StatisticsRepository, Tokens, Totals};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

const SAFE_COUNTER: i64 = 9_007_199_254_740_991;

fn add(first: i64, second: i64) -> Result<i64> {
    first
        .checked_add(second)
        .filter(|value| (0..=SAFE_COUNTER).contains(value))
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Statistics counter overflow"))
}

fn totals(first: &Totals, second: &Totals) -> Result<Totals> {
    Ok(Totals {
        observed: add(first.observed, second.observed)?,
        delivered: add(first.delivered, second.delivered)?,
        content_bytes: add(first.content_bytes, second.content_bytes)?,
        delivered_bytes: add(first.delivered_bytes, second.delivered_bytes)?,
        attachment_bytes: add(first.attachment_bytes, second.attachment_bytes)?,
        largest_bytes: first.largest_bytes.max(second.largest_bytes),
    })
}

fn optional_sum(first: Option<i64>, second: Option<i64>) -> Result<Option<i64>> {
    match (first, second) {
        (Some(first), Some(second)) => add(first, second).map(Some),
        _ => Ok(None),
    }
}

fn tokens(first: &Tokens, second: &Tokens) -> Result<Tokens> {
    Ok(Tokens {
        input: add(first.input, second.input)?,
        cached_input: add(first.cached_input, second.cached_input)?,
        cache_write_input: optional_sum(first.cache_write_input, second.cache_write_input)?,
        output: add(first.output, second.output)?,
        reasoning_output: optional_sum(first.reasoning_output, second.reasoning_output)?,
        total: add(first.total, second.total)?,
    })
}

impl StatisticsRepository for Store {
    fn record_statistics(
        &mut self,
        agent_id: &str,
        run_id: &str,
        batch: &Batch,
        now: i64,
    ) -> Result<()> {
        record::record(self, agent_id, run_id, batch, now)
    }
    fn statistics(
        &mut self,
        agent_ids: &[String],
        since: i64,
        page: i64,
        page_size: i64,
    ) -> Result<Statistics> {
        read::read(self, agent_ids, since, page, page_size)
    }
}
