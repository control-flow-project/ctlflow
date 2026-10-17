use crossfire_kernel::{Failure, Result, failure::ErrorCode};

pub use toml::{Table, Value};
pub const MAXIMUM_BYTES: usize = 1024 * 1024;

pub fn parse(bytes: &[u8]) -> Result<Table> {
    if bytes.len() > MAXIMUM_BYTES {
        return Err(Failure::new(
            ErrorCode::BodyTooLarge,
            "Native TOML configuration exceeds its byte bound",
        ));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| {
        Failure::new(
            ErrorCode::Invalid,
            "Native TOML configuration must be valid UTF-8",
        )
    })?;
    text.parse().map_err(|_| {
        Failure::new(
            ErrorCode::Invalid,
            "Cannot read the native configuration as valid TOML",
        )
    })
}

pub fn format(table: &Table) -> Result<String> {
    let text = toml::to_string(table).map_err(|_| {
        Failure::new(
            ErrorCode::Invalid,
            "Cannot format the native configuration as TOML",
        )
    })?;
    if text.len() > MAXIMUM_BYTES {
        return Err(Failure::new(
            ErrorCode::BodyTooLarge,
            "Native TOML configuration exceeds its byte bound",
        ));
    }
    Ok(text)
}
