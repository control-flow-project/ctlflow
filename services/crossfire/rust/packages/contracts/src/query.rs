use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::BTreeMap;

pub fn parameters<'a>(
    input: &'a [(String, String)],
    allowed: &[&str],
) -> Result<BTreeMap<&'a str, &'a str>> {
    let mut result = BTreeMap::new();
    for (key, value) in input {
        if !allowed.contains(&key.as_str()) || result.insert(key.as_str(), value.as_str()).is_some()
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Unknown or duplicated query parameters",
            ));
        }
    }
    Ok(result)
}
fn number(value: &str) -> Option<f64> {
    let value = value.trim_matches(crate::validation::whitespace);
    if value.is_empty() {
        return Some(0.0);
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0b", 2),
        ("0B", 2),
        ("0o", 8),
        ("0O", 8),
    ] {
        if let Some(digits) = value.strip_prefix(prefix) {
            if digits.is_empty() {
                return None;
            }
            let mut result = 0.0;
            for digit in digits.chars() {
                result = result * radix as f64 + digit.to_digit(radix)? as f64;
            }
            return Some(result);
        }
    }
    if value
        .bytes()
        .any(|character| !b"0123456789eE+-.".contains(&character))
    {
        return None;
    }
    value.parse::<f64>().ok()
}
pub fn pagination(input: &BTreeMap<&str, &str>) -> Result<(i64, i64)> {
    let valid = |value: &str, maximum: f64| {
        number(value).filter(|value| {
            value.is_finite() && value.fract() == 0.0 && *value >= 1.0 && *value <= maximum
        })
    };
    match (
        valid(input.get("page").copied().unwrap_or("1"), 100_000.0),
        valid(input.get("pageSize").copied().unwrap_or("20"), 100.0),
    ) {
        (Some(page), Some(size)) => Ok((page as i64, size as i64)),
        _ => Err(Failure::new(
            ErrorCode::Invalid,
            "Use page ≥ 1 and pageSize 1–100",
        )),
    }
}
