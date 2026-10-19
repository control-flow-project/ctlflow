use crate::port::UnitOfWork;
use crossfire_kernel::Result;

pub const INTERVAL_MS: i64 = 5 * 60_000;
pub const MAX_FLOWS: usize = 256;
pub const MAX_SESSIONS: usize = 32;
pub const RECENT_EVENTS: usize = 2048;
pub const MAXIMUM_COUNT: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Tokens {
    pub input: i64,
    pub cached_input: i64,
    pub cache_write_input: Option<i64>,
    pub output: i64,
    pub reasoning_output: Option<i64>,
    pub total: i64,
}

impl Tokens {
    pub fn valid(&self) -> bool {
        [self.input, self.cached_input, self.output, self.total]
            .into_iter()
            .all(|value| (0..=MAXIMUM_COUNT).contains(&value))
            && self.cached_input <= self.input
            && self
                .cache_write_input
                .is_none_or(|value| (0..=self.input).contains(&value))
            && self
                .reasoning_output
                .is_none_or(|value| (0..=self.output).contains(&value))
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Totals {
    pub observed: i64,
    pub delivered: i64,
    pub content_bytes: i64,
    pub delivered_bytes: i64,
    pub attachment_bytes: i64,
    pub largest_bytes: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Flow {
    pub room_id: String,
    pub sender_backend_user_id: String,
    pub message_type: String,
    pub totals: Totals,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Usage {
    pub runtime: String,
    pub session_id: String,
    pub tokens: Tokens,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Batch {
    pub sequence: i64,
    pub started_at: i64,
    pub ended_at: i64,
    pub dropped: i64,
    pub flows: Vec<Flow>,
    pub usage: Vec<Usage>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentStatistics {
    pub agent_id: String,
    pub totals: Totals,
    pub tokens: Option<Tokens>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FlowRecord {
    pub agent_id: String,
    pub flow: Flow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Statistics {
    pub intervals: i64,
    pub dropped: i64,
    pub first_report_at: Option<i64>,
    pub last_report_at: Option<i64>,
    pub totals: Totals,
    pub agents: Vec<AgentStatistics>,
    pub flows: Vec<FlowRecord>,
    pub total_flows: i64,
    pub tokens: Option<Tokens>,
}

pub trait StatisticsRepository: UnitOfWork {
    fn record_statistics(
        &mut self,
        agent_id: &str,
        run_id: &str,
        batch: &Batch,
        now: i64,
    ) -> Result<()>;
    fn statistics(
        &mut self,
        agent_ids: &[String],
        since: i64,
        page: i64,
        page_size: i64,
    ) -> Result<Statistics>;
}
