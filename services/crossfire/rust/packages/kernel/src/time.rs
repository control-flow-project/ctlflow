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
