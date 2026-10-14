use crossfire_adapter_schedule::next;
use crossfire_domain::schedule::Schedule;
use serde::Deserialize;
use std::io::{self, Read};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
enum WireSchedule {
    Interval {
        seconds: i64,
    },
    Cron {
        expression: String,
        #[serde(rename = "timeZone")]
        time_zone: String,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Case {
    schedule: WireSchedule,
    after: i64,
    expected: Option<i64>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().count() != 1 {
        return Err("Provide the bounded calendar corpus on standard input".into());
    }
    let mut input = Vec::new();
    io::stdin().lock().take(8_388_609).read_to_end(&mut input)?;
    if input.len() > 8_388_608 {
        return Err("Calendar corpus exceeds its resource bound".into());
    }
    let cases: Vec<Case> = serde_json::from_slice(&input)?;
    let mut failures = Vec::new();
    let mut failure_count = 0;
    for case in &cases {
        let schedule = match &case.schedule {
            WireSchedule::Interval { seconds } => Schedule::Interval { seconds: *seconds },
            WireSchedule::Cron {
                expression,
                time_zone,
            } => Schedule::Cron {
                expression: expression.clone(),
                time_zone: time_zone.clone(),
            },
        };
        let observed = next(&schedule, case.after).ok();
        if observed != case.expected {
            failure_count += 1;
            if failures.len() < 16 {
                failures.push(format!(
                    "{schedule:?} after {}: expected {:?}, observed {observed:?}",
                    case.after, case.expected
                ));
            }
        }
    }
    if failure_count != 0 {
        return Err(format!(
            "{failure_count} calendar mismatches: {}",
            failures.join("\n")
        )
        .into());
    }
    println!("{{\"status\":\"passed\",\"cases\":{}}}", cases.len());
    Ok(())
}
