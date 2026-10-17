use crossfire_kernel::{Failure, Result, failure::ErrorCode};
pub fn parse(value: &str) -> Result<url::Url> {
    let endpoint = url::Url::parse(value)
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid server origin"))?;
    let host = endpoint.host_str().unwrap_or_default();
    if !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
        || endpoint.path() != "/"
        || endpoint.scheme() != "https"
            && !(endpoint.scheme() == "http" && ["127.0.0.1", "[::1]", "localhost"].contains(&host))
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Use HTTPS or a loopback HTTP origin without credentials",
        ));
    }
    Ok(endpoint)
}

pub fn segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            encoded.push(char::from(byte));
        } else {
            use std::fmt::Write;
            let _formatted = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
}
