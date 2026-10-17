mod operations;
mod runtime;
mod statistics;
mod workflows;

use crate::store::Store;
use crossfire_domain::{
    logging::{Cursor, LoggingRepository, PruneInput, PruneResult},
    port::UnitOfWork,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

pub(super) struct ScanResult {
    pub removed: usize,
    pub more: bool,
    pub cursor: Option<Cursor>,
}

pub(super) fn scan_result(scanned: &[(String, i64)], removed: usize, limit: i64) -> ScanResult {
    let more = scanned.len() as i64 == limit;
    ScanResult {
        removed,
        more,
        cursor: if more {
            scanned.last().map(|(id, at)| Cursor {
                at: *at,
                id: id.clone(),
            })
        } else {
            None
        },
    }
}

impl LoggingRepository for Store {
    fn prune_logging(&mut self, input: &PruneInput<'_>) -> Result<PruneResult> {
        if !(1..=1000).contains(&input.limit)
            || !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&input.cutoff)
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid logging cutoff or batch",
            ));
        }
        self.transaction(|store| {
            let mut batches = statistics::prune(store, input.cutoff, input.limit)?;
            batches.extend(workflows::prune(store, input.cutoff, input.limit)?);
            batches.extend(runtime::prune(store, input.cutoff, input.limit)?);
            let runs = runtime::runs(store, input.cutoff, input.limit, input.runs)?;
            let operations = operations::prune(store, input.cutoff, input.limit, input.operations)?;
            Ok(PruneResult {
                removed: (runs.removed + operations.removed + batches.iter().sum::<usize>()) as i64,
                more: runs.more
                    || operations.more
                    || batches.iter().any(|count| *count as i64 == input.limit),
                runs: runs.cursor,
                operations: operations.cursor,
            })
        })
    }
}
