use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::BTreeMap;
pub mod operations;

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
pub fn pagination(input: &BTreeMap<&str, &str>) -> Result<(i64, i64)> {
    let valid = |value: &str, maximum: i64| {
        if !value.starts_with(|character: char| matches!(character, '1'..='9'))
            || !value.bytes().all(|byte| byte.is_ascii_digit())
        {
            return None;
        }
        value.parse::<i64>().ok().filter(|value| *value <= maximum)
    };
    match (
        valid(input.get("page").copied().unwrap_or("1"), 100_000),
        valid(input.get("pageSize").copied().unwrap_or("20"), 100),
    ) {
        (Some(page), Some(size)) => Ok((page, size)),
        _ => Err(Failure::new(
            ErrorCode::Invalid,
            "Use page ≥ 1 and pageSize 1–100",
        )),
    }
}
