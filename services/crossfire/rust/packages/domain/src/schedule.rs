use crossfire_kernel::Result;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Schedule {
    Interval {
        seconds: i64,
    },
    Cron {
        expression: String,
        time_zone: String,
    },
}

pub trait ScheduleCalculator {
    fn next(&self, schedule: &Schedule, after: i64) -> Result<i64>;
}
