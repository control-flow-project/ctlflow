use crate::invalid;
use chrono::{Datelike, NaiveDate};
use crossfire_kernel::Result;

#[derive(Debug)]
pub(crate) struct Field {
    pub mask: u64,
    pub wildcard: bool,
    last: bool,
    last_weekday: u64,
    nth: u32,
}

pub(crate) struct Calendar {
    pub minute: Field,
    pub hour: Field,
    pub day: Field,
    pub month: Field,
    pub weekday: Field,
}

pub(crate) fn contains(mask: u64, value: u32) -> bool {
    mask & (1_u64 << value) != 0
}

fn number(source: &str) -> Result<u32> {
    if source.is_empty() || !source.bytes().all(|value| value.is_ascii_digit()) {
        return Err(invalid("Invalid calendar value"));
    }
    source
        .parse()
        .map_err(|_| invalid("Calendar value is out of range"))
}

fn stride(source: &str, maximum: u32) -> Result<u32> {
    if source.is_empty() || !source.bytes().all(|value| value.is_ascii_digit()) {
        return Err(invalid("Invalid calendar step"));
    }
    let value = source.bytes().fold(0_u32, |total, digit| {
        total
            .saturating_mul(10)
            .saturating_add(u32::from(digit - b'0'))
            .min(maximum + 1)
    });
    if value == 0 {
        return Err(invalid("Invalid calendar step"));
    }
    Ok(value)
}

fn aliases(source: &str, index: usize) -> Result<String> {
    let names = if index == 3 {
        &[
            "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
        ][..]
    } else {
        &["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][..]
    };
    if !source.is_ascii() {
        return Err(invalid("Invalid calendar field"));
    }
    let mut result = String::with_capacity(source.len());
    let mut position = 0;
    while position < source.len() {
        let rest = &source[position..];
        if rest.len() >= 3 && rest.as_bytes()[..3].iter().all(u8::is_ascii_alphabetic) {
            let name = &rest[..3];
            let offset = names
                .iter()
                .position(|candidate| candidate.eq_ignore_ascii_case(name))
                .ok_or_else(|| invalid("Unknown calendar month or weekday"))?;
            result.push_str(&(offset + usize::from(index == 3)).to_string());
            position += 3;
        } else {
            result.push(char::from(source.as_bytes()[position]));
            position += 1;
        }
    }
    Ok(result)
}

fn field(source: &str, minimum: u32, maximum: u32, index: usize) -> Result<Field> {
    let text = if matches!(index, 3 | 4) {
        aliases(source, index)?
    } else {
        source.to_owned()
    };
    let mut value = Field {
        mask: 0,
        wildcard: matches!(source, "*" | "?"),
        last: false,
        last_weekday: 0,
        nth: 0,
    };
    let mut body = text.as_str();
    if let Some((selected, nth)) = text.split_once('#') {
        if index != 4 || selected.contains([',', '-', '/']) || nth.contains('#') {
            return Err(invalid("Invalid calendar weekday occurrence"));
        }
        value.nth = number(nth)?;
        if !(1..=5).contains(&value.nth) {
            return Err(invalid("Invalid calendar weekday occurrence"));
        }
        body = selected;
    }
    for selection in body.split(',') {
        if selection == "L" && index == 2 {
            if value.last {
                return Err(invalid("Duplicate calendar value"));
            }
            value.last = true;
            continue;
        }
        if let Some(last) = selection.strip_suffix('L').filter(|_| index == 4) {
            let selected = number(last)?;
            if selected > 7 {
                return Err(invalid("Calendar value is out of range"));
            }
            let bit = 1_u64 << (selected % 7);
            if value.last_weekday & bit != 0 {
                return Err(invalid("Duplicate calendar value"));
            }
            value.last_weekday |= bit;
            continue;
        }
        let (range, step) = match selection.split_once('/') {
            Some((range, step)) => (range, stride(step, maximum)?),
            None => (selection, 1),
        };
        let (start, end) = if matches!(range, "*" | "?") {
            (minimum, maximum)
        } else if let Some((start, end)) = range.split_once('-') {
            (number(start)?, number(end)?)
        } else {
            let selected = number(range)?;
            (
                selected,
                if selection.contains('/') {
                    maximum
                } else {
                    selected
                },
            )
        };
        if start < minimum || end > maximum || start > end {
            return Err(invalid("Calendar value is out of range"));
        }
        let mut selected = 0_u64;
        for number in (start..=end).step_by(step as usize) {
            selected |= 1_u64 << if index == 4 { number % 7 } else { number };
        }
        if value.mask & selected != 0 {
            return Err(invalid("Duplicate calendar value"));
        }
        value.mask |= selected;
    }
    if value.mask == 0 && !value.last && value.last_weekday == 0 {
        return Err(invalid("Empty calendar field"));
    }
    Ok(value)
}

impl Calendar {
    pub fn parse(expression: &str) -> Result<Self> {
        let parts: Vec<_> = expression
            .split(crossfire_kernel::text::whitespace)
            .filter(|part| !part.is_empty())
            .collect();
        let [minute, hour, day, month, weekday] = parts.as_slice() else {
            return Err(invalid(
                "Use five cron fields; randomized fields and seconds are not supported",
            ));
        };
        let value = Self {
            minute: field(minute, 0, 59, 0)?,
            hour: field(hour, 0, 23, 1)?,
            day: field(day, 1, 31, 2)?,
            month: field(month, 1, 12, 3)?,
            weekday: field(weekday, 0, 7, 4)?,
        };
        for year in 2000..2400 {
            for month in 1..=12 {
                if !contains(value.month.mask, month) {
                    continue;
                }
                for day in 1..=31 {
                    if let Some(date) = NaiveDate::from_ymd_opt(year, month, day)
                        && value.matches_day(date)?
                    {
                        return Ok(value);
                    }
                }
            }
        }
        Err(invalid("The calendar schedule is impossible"))
    }

    pub fn matches_day(&self, date: NaiveDate) -> Result<bool> {
        let weekday = date.weekday().num_days_from_sunday();
        let month_end = month_end(date)?;
        let day = contains(self.day.mask, date.day()) || self.day.last && date.day() == month_end;
        let week = contains(self.weekday.mask, weekday)
            && (self.weekday.nth == 0 || (date.day() - 1) / 7 + 1 == self.weekday.nth)
            || contains(self.weekday.last_weekday, weekday) && date.day() + 7 > month_end;
        Ok(if self.day.wildcard {
            week
        } else if self.weekday.wildcard {
            day
        } else {
            day || week
        })
    }
}

fn month_end(date: NaiveDate) -> Result<u32> {
    for day in (28..=31).rev() {
        if NaiveDate::from_ymd_opt(date.year(), date.month(), day).is_some() {
            return Ok(day);
        }
    }
    Err(invalid("Invalid calendar date"))
}
