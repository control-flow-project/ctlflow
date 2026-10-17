use crossfire_kernel::{Failure, Result, failure::ErrorCode};

pub const DAY_MS: i64 = 86_400_000;
pub const DEFAULT_DAYS: i64 = 7;
pub const MAINTENANCE_MS: i64 = 3_600_000;
const SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cursor {
    pub at: i64,
    pub id: String,
}

pub struct PruneInput<'a> {
    pub cutoff: i64,
    pub limit: i64,
    pub runs: Option<&'a Cursor>,
    pub operations: Option<&'a Cursor>,
}

pub struct PruneResult {
    pub removed: i64,
    pub more: bool,
    pub runs: Option<Cursor>,
    pub operations: Option<Cursor>,
}

pub trait LoggingRepository {
    fn prune_logging(&mut self, input: &PruneInput<'_>) -> Result<PruneResult>;
}

pub struct Retention {
    days: i64,
    previous_cutoff: Option<i64>,
    runs: Option<Cursor>,
    operations: Option<Cursor>,
}

impl Retention {
    pub fn new(days: Option<i64>) -> Result<Self> {
        let days = days.unwrap_or(DEFAULT_DAYS);
        if days <= 0
            || days
                .checked_mul(DAY_MS)
                .is_none_or(|value| value > SAFE_INTEGER)
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "loggingRetentionDays must be a positive exact integer number of days",
            ));
        }
        Ok(Self {
            days,
            previous_cutoff: None,
            runs: None,
            operations: None,
        })
    }

    pub fn days(&self) -> i64 {
        self.days
    }

    pub fn maintain(
        &mut self,
        repo: &mut impl LoggingRepository,
        now: i64,
        limit: i64,
    ) -> Result<(i64, bool)> {
        let cutoff = now
            .checked_sub(self.days * DAY_MS)
            .filter(|value| (-SAFE_INTEGER..=SAFE_INTEGER).contains(value));
        let Some(cutoff) = cutoff.filter(|_| (1..=1000).contains(&limit)) else {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Logging cleanup requires an exact cutoff and a 1..1000 record batch",
            ));
        };
        let reset = self.previous_cutoff.is_some_and(|before| cutoff < before);
        let result = repo.prune_logging(&PruneInput {
            cutoff,
            limit,
            runs: if reset { None } else { self.runs.as_ref() },
            operations: if reset {
                None
            } else {
                self.operations.as_ref()
            },
        })?;
        self.previous_cutoff = Some(cutoff);
        self.runs = result.runs;
        self.operations = result.operations;
        Ok((result.removed, result.more))
    }
}
