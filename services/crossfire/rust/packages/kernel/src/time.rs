use crate::{Failure, Result, failure::ErrorCode};
pub trait Clock {
    fn now(&self) -> Result<i64>;
}
impl<F: Fn() -> Result<i64>> Clock for F {
    fn now(&self) -> Result<i64> {
        self()
    }
}
pub const MAX_TIMESTAMP: i64 = 8_640_000_000_000_000;
pub fn parse_iso_timestamp(value: &str) -> Result<i64> {
    let invalid = || {
        Failure::new(
            ErrorCode::Invalid,
            "Timestamp is not in the canonical shared calendar format",
        )
    };
    let (date, time) = value.split_once('T').ok_or_else(invalid)?;
    let (month_year, day) = date.rsplit_once('-').ok_or_else(invalid)?;
    let (year, month) = month_year.rsplit_once('-').ok_or_else(invalid)?;
    let number = |text: &str| text.parse::<i64>().map_err(|_| invalid());
    let year = number(year)?;
    let month = number(month)?;
    let day = number(day)?;
    if !(-271821..=275760).contains(&year)
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || time.len() != 13
        || !time.is_ascii()
        || &time[2..3] != ":"
        || &time[5..6] != ":"
        || &time[8..9] != "."
        || &time[12..] != "Z"
    {
        return Err(invalid());
    }
    let hour = number(&time[..2])?;
    let minute = number(&time[3..5])?;
    let second = number(&time[6..8])?;
    let millis = number(&time[9..12])?;
    if hour > 23 || minute > 59 || second > 59 {
        return Err(invalid());
    }
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let era_year = year - era * 400;
    let phase = month + if month > 2 { -3 } else { 9 };
    let day_year = (153 * phase + 2) / 5 + day - 1;
    let days = era * 146097 + era_year * 365 + era_year / 4 - era_year / 100 + day_year - 719468;
    let result = days * 86400000 + hour * 3600000 + minute * 60000 + second * 1000 + millis;
    if iso_timestamp(result)? != value {
        return Err(invalid());
    }
    Ok(result)
}
pub fn iso_timestamp(milliseconds: i64) -> Result<String> {
    if !(-MAX_TIMESTAMP..=MAX_TIMESTAMP).contains(&milliseconds) {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Timestamp exceeds the shared calendar range",
        ));
    }
    let days = milliseconds.div_euclid(86_400_000);
    let time = milliseconds.rem_euclid(86_400_000);
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let era_day = shifted - era * 146_097;
    let era_year = (era_day - era_day / 1460 + era_day / 36_524 - era_day / 146_096) / 365;
    let mut year = era_year + era * 400;
    let year_day = era_day - (365 * era_year + era_year / 4 - era_year / 100);
    let month_phase = (5 * year_day + 2) / 153;
    let day = year_day - (153 * month_phase + 2) / 5 + 1;
    let month = month_phase + if month_phase < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    let year = if (0..=9999).contains(&year) {
        format!("{year:04}")
    } else if year < 0 {
        format!("-{:06}", -year)
    } else {
        format!("+{year:06}")
    };
    Ok(format!(
        "{year}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time / 3_600_000,
        time / 60_000 % 60,
        time / 1000 % 60,
        time % 1000
    ))
}
