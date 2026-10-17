use crate::time_zone::{Zone, zone};
use crate::{
    fields::{Calendar, contains},
    invalid,
};
use chrono::{DateTime, Datelike, FixedOffset, LocalResult, NaiveDateTime, Offset, TimeDelta, Utc};
use crossfire_kernel::Result;

fn earliest(value: LocalResult<DateTime<FixedOffset>>) -> Option<DateTime<FixedOffset>> {
    match value {
        LocalResult::Single(value) => Some(value),
        LocalResult::Ambiguous(first, second) => Some(first.min(second)),
        LocalResult::None => None,
    }
}

fn resolve(zone: &Zone, local: NaiveDateTime) -> Result<DateTime<FixedOffset>> {
    if let Some(value) = earliest(zone.local(local)?) {
        return Ok(value);
    }
    let mut before = None;
    let mut after = None;
    for hours in 1..=49 {
        if before.is_none() {
            before = local
                .checked_sub_signed(TimeDelta::hours(hours))
                .map(|time| zone.local(time).map(earliest))
                .transpose()?
                .flatten();
        }
        if after.is_none() {
            after = local
                .checked_add_signed(TimeDelta::hours(hours))
                .map(|time| zone.local(time).map(earliest))
                .transpose()?
                .flatten();
        }
        if before.is_some() && after.is_some() {
            break;
        }
    }
    let (Some(before), Some(after)) = (before, after) else {
        return Err(invalid("Calendar time-zone gap cannot be resolved"));
    };
    let difference = i64::from(after.offset().fix().local_minus_utc())
        - i64::from(before.offset().fix().local_minus_utc());
    local
        .checked_add_signed(TimeDelta::seconds(difference))
        .map(|time| zone.local(time).map(earliest))
        .transpose()?
        .flatten()
        .ok_or_else(|| invalid("Calendar time-zone gap cannot be resolved"))
}

pub(crate) fn next(expression: &str, time_zone: &str, after: i64) -> Result<i64> {
    let expression = expression.trim_matches(crossfire_kernel::text::whitespace);
    if expression.len() > 200 {
        return Err(invalid("Calendar expression exceeds its size limit"));
    }
    let calendar = Calendar::parse(expression)?;
    let zone = zone(time_zone)?;
    let instant = DateTime::<Utc>::from_timestamp_millis(after)
        .ok_or_else(|| invalid("Invalid scheduling time"))?;
    let zoned = zone.at(instant)?;
    let local = zoned.naive_local();
    let mut day = local.date();
    let end_year = day
        .year()
        .checked_add(400)
        .ok_or_else(|| invalid("Scheduling time exceeds the supported range"))?;
    while day.year() <= end_year {
        if contains(calendar.month.mask, day.month()) && calendar.matches_day(day)? {
            let mut first = None;
            for hour in 0..24 {
                if !contains(calendar.hour.mask, hour) {
                    continue;
                }
                for minute in 0..60 {
                    if !contains(calendar.minute.mask, minute) {
                        continue;
                    }
                    let candidate = day
                        .and_hms_opt(hour, minute, 0)
                        .ok_or_else(|| invalid("Invalid calendar date"))?;
                    let mapped = zone.local(candidate)?;
                    let ambiguous = matches!(mapped, LocalResult::Ambiguous(_, _));
                    let every_hour = calendar.hour.mask == 0xff_ffff;
                    if candidate < local && !(ambiguous && every_hour) {
                        continue;
                    }
                    let mut value = resolve(&zone, candidate)?;
                    let repeated_local = match zone.local(local)? {
                        LocalResult::Ambiguous(first, second) => zoned == first.max(second),
                        _ => false,
                    };
                    if ambiguous
                        && (every_hour || day == local.date() && repeated_local)
                        && value.timestamp_millis() <= after
                        && let LocalResult::Ambiguous(first, second) = mapped
                    {
                        value = first.max(second);
                    }
                    let timestamp = value.timestamp_millis();
                    if timestamp <= after {
                        continue;
                    }
                    let resolved_day = value.naive_local().date();
                    if resolved_day != candidate.date()
                        && (!contains(calendar.month.mask, resolved_day.month())
                            || !calendar.matches_day(resolved_day)?)
                    {
                        continue;
                    }
                    first = Some(first.map_or(timestamp, |current: i64| current.min(timestamp)));
                }
            }
            if let Some(timestamp) = first {
                return Ok(timestamp);
            }
        }
        day = day
            .succ_opt()
            .ok_or_else(|| invalid("The schedule has no next occurrence"))?;
    }
    Err(invalid("The schedule has no next occurrence"))
}
