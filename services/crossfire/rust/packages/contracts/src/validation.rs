use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Map, Value};

pub const SAFE_INTEGER: i64 = 9_007_199_254_740_991;

pub fn utf16_length(value: &str) -> usize {
    value.encode_utf16().count()
}

pub fn truncate_utf16(value: &str, maximum: usize) -> &str {
    let mut length = 0;
    for (offset, character) in value.char_indices() {
        length += character.len_utf16();
        if length > maximum {
            return &value[..offset];
        }
    }
    value
}

pub fn text(value: &Value, minimum: usize, maximum: usize) -> Result<&str> {
    value
        .as_str()
        .filter(|value| {
            let length = utf16_length(value);
            length >= minimum
                && length <= maximum
                && !value
                    .chars()
                    .any(|character| character <= '\u{1f}' || character == '\u{7f}')
        })
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Invalid,
                format!("Expected text of {minimum}–{maximum} characters"),
            )
        })
}

pub fn plain_text(value: &Value, maximum: usize) -> Result<&str> {
    value
        .as_str()
        .filter(|value| {
            value.len() <= maximum && !value.chars().any(|character|
        matches!(character, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}'))
        })
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Invalid,
                format!("Expected plain text up to {maximum} UTF-8 bytes"),
            )
        })
}

pub fn integer(value: &Value, minimum: i64, maximum: i64) -> Result<i64> {
    let numeric = value.as_i64().or_else(|| {
        value
            .as_f64()
            .filter(|number| {
                number.is_finite() && number.fract() == 0.0 && number.abs() <= SAFE_INTEGER as f64
            })
            .map(|number| number as i64)
    });
    numeric
        .filter(|number| {
            (-SAFE_INTEGER..=SAFE_INTEGER).contains(number)
                && *number >= minimum
                && *number <= maximum
        })
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Expected a bounded integer"))
}

pub fn boolean(value: &Value) -> Result<bool> {
    value
        .as_bool()
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Expected a boolean"))
}

pub fn choice<'a>(value: &'a Value, choices: &[&str]) -> Result<&'a str> {
    value
        .as_str()
        .filter(|value| choices.contains(value))
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Invalid,
                format!("Choose one of: {}", choices.join(", ")),
            )
        })
}

pub fn identifier(value: &Value) -> Result<&str> {
    value
        .as_str()
        .filter(|value| {
            value.len() == 36
                && value.bytes().enumerate().all(|(position, character)| {
                    if [8, 13, 18, 23].contains(&position) {
                        character == b'-'
                    } else {
                        character.is_ascii_digit() || (b'a'..=b'f').contains(&character)
                    }
                })
        })
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Expected an opaque UUID"))
}

pub fn name(value: &Value) -> Result<&str> {
    value
        .as_str()
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 40
                && value.as_bytes()[0].is_ascii_lowercase()
                && value.bytes().all(|character| {
                    character.is_ascii_lowercase()
                        || character.is_ascii_digit()
                        || character == b'-'
                })
        })
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Invalid,
                "Expected a lowercase name of 1–40 characters",
            )
        })
}

pub use crossfire_kernel::text::whitespace;

pub fn matrix_user_id(value: &Value) -> Result<&str> {
    value
        .as_str()
        .filter(|value| {
            utf16_length(value) <= 255
                && value.starts_with('@')
                && !value.chars().any(whitespace)
                && value[1..]
                    .split_once(':')
                    .is_some_and(|(local, host)| !local.is_empty() && !host.is_empty())
        })
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Expected a Matrix user ID"))
}

fn native_id(value: &Value, prefix: char, message: &str) -> Result<String> {
    value
        .as_str()
        .filter(|value| {
            utf16_length(value) <= 255
                && value.starts_with(prefix)
                && value.len() > 1
                && !value.chars().any(whitespace)
        })
        .map(str::to_owned)
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, message))
}

pub fn room_id(value: &Value) -> Result<String> {
    native_id(value, '!', "Expected an immutable Matrix room ID")
}
pub fn event_id(value: &Value) -> Result<String> {
    native_id(value, '$', "Expected a Matrix event ID")
}

pub fn secret(value: &Value) -> Result<&str> {
    value
        .as_str()
        .filter(|value| {
            value.len() == 43
                && value.bytes().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, b'_' | b'-')
                })
        })
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Expected a private 32-byte claim"))
}

pub fn object<'a>(
    value: &'a Value,
    required: &[&str],
    optional: &[&str],
) -> Result<&'a Map<String, Value>> {
    let object = value
        .as_object()
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Expected an object"))?;
    if object
        .keys()
        .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err(Failure::new(ErrorCode::Invalid, "Unknown request fields"));
    }
    if let Some(missing) = required.iter().find(|key| !object.contains_key(**key)) {
        return Err(Failure::new(ErrorCode::Invalid, "Required field is missing").field(missing));
    }
    Ok(object)
}

pub fn list(value: &Value, minimum: usize, maximum: usize) -> Result<&[Value]> {
    value
        .as_array()
        .filter(|items| items.len() >= minimum && items.len() <= maximum)
        .map(Vec::as_slice)
        .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Expected a bounded list"))
}
