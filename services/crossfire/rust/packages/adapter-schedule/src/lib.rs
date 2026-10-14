mod calendar;
mod fields;

use crossfire_domain::schedule::{Schedule, ScheduleCalculator};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

const MAXIMUM_TIME: i64 = 9_007_199_254_740_991;

pub struct Calculator;

impl ScheduleCalculator for Calculator {
    fn next(&self, schedule: &Schedule, after: i64) -> Result<i64> {
        next(schedule, after)
    }
}

pub fn next(schedule: &Schedule, after: i64) -> Result<i64> {
    if !(0..=MAXIMUM_TIME).contains(&after) {
        return Err(invalid("Invalid scheduling time"));
    }
    match schedule {
        Schedule::Interval { seconds } => {
            if !(1..=31_536_000).contains(seconds) {
                return Err(invalid("Interval must be between 1 second and 365 days"));
            }
            after
                .checked_add(seconds * 1000)
                .filter(|next| *next <= MAXIMUM_TIME)
                .ok_or_else(|| invalid("Scheduling time exceeds the supported range"))
        }
        Schedule::Cron {
            expression,
            time_zone,
        } => calendar::next(expression, time_zone, after),
    }
}

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
