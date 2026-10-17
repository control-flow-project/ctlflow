use crossfire_adapter_schedule::next;
use crossfire_domain::schedule::Schedule;

fn cron(expression: &str, time_zone: &str) -> Schedule {
    Schedule::Cron {
        expression: expression.to_owned(),
        time_zone: time_zone.to_owned(),
    }
}

#[test]
fn intervals_preserve_exact_time_and_enforce_wire_bounds() -> Result<(), Box<dyn std::error::Error>>
{
    assert_eq!(
        next(&Schedule::Interval { seconds: 60 }, 1_700_000_000_123)?,
        1_700_000_060_123
    );
    for (seconds, after) in [
        (0, 0),
        (31_536_001, 0),
        (60, -1),
        (60, 9_007_199_254_740_990),
    ] {
        assert!(next(&Schedule::Interval { seconds }, after).is_err());
    }
    Ok(())
}

#[test]
fn calendar_rejects_impossible_unsafe_and_ambiguous_syntax() {
    for expression in [
        "0 0 31 4 *",
        "60 * * * *",
        "0 0 * * 5,5",
        "0 0 * * 0,7",
        "H * * * *",
        "0 0 * * 1#6",
        "0 0 * * MON/0",
        "0 0 * * 1#1/2",
        "0 0 0 * * *",
    ] {
        assert!(next(&cron(expression, "UTC"), 0).is_err(), "{expression}");
    }
    assert!(next(&cron("0 0 * * *", "../UTC"), 0).is_err());
    assert!(next(&cron("0 0 * * *", "America/No_Such_Zone"), 0).is_err());
}

#[test]
fn calendar_supports_case_insensitive_zone_names_and_non_hour_offsets()
-> Result<(), Box<dyn std::error::Error>> {
    assert_eq!(
        next(&cron("0 9 * * MON-FRI", "Asia/Kolkata"), 1_767_225_600_000)?,
        1_767_238_200_000
    );
    assert_eq!(next(&cron("0 0 * * *", "utc"), 1)?, 86_400_000);
    assert_eq!(next(&cron("0 0 * * *", "GMT"), 1)?, 86_400_000);
    Ok(())
}
