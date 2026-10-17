use crate::server::{Method, Request};
use crossfire_contracts::{
    call::Key,
    operations::{self, Operation, OperationId},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use percent_encoding::percent_decode_str;
use serde_json::json;
use std::collections::BTreeMap;

pub struct Selection<Id: 'static = OperationId> {
    pub operation: &'static Operation<Id>,
    pub parameters: BTreeMap<String, String>,
}
impl<Id: Key> Selection<Id> {
    pub fn validate(&self) -> Result<()> {
        for (key, value) in &self.parameters {
            self.operation.id.validate_parameter(key, &json!(value))?;
        }
        Ok(())
    }
    pub fn parameter(&self, key: &str) -> Result<&str> {
        self.parameters.get(key).map(String::as_str).ok_or_else(|| {
            Failure::new(
                ErrorCode::Unavailable,
                "The declared route parameter is missing",
            )
        })
    }
}
pub fn path<Body>(request: &Request<Body>) -> Result<&str> {
    let uri = request.uri();
    let path = uri.path();
    if uri.scheme().is_some()
        || uri.authority().is_some()
        || uri.to_string().len() > 65536
        || !path.starts_with('/')
        || path.starts_with("//")
        || path
            .chars()
            .any(|value| value <= '\u{20}' || value == '\u{7f}' || matches!(value, '\\' | '#'))
    {
        return Err(Failure::new(ErrorCode::Invalid, "Invalid request URL"));
    }
    if path.split('/').any(|part| matches!(part, "." | ".."))
        || decode(path)?
            .split('/')
            .any(|part| matches!(part, "." | ".."))
    {
        return Err(Failure::new(ErrorCode::Missing, "Route not found"));
    }
    Ok(path)
}
pub fn decode(value: &str) -> Result<String> {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Invalid request path encoding",
                ));
            }
            index += 2;
        }
        index += 1;
    }
    let value = percent_decode_str(value)
        .decode_utf8()
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid request path encoding"))?;
    if value
        .chars()
        .any(|value| value <= '\u{1f}' || value == '\u{7f}' || value == '\\')
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid request path encoding",
        ));
    }
    Ok(value.into_owned())
}
fn matches(template: &str, path: &str) -> Result<Option<BTreeMap<String, String>>> {
    let mut parameters = BTreeMap::new();
    let mut expected = template.split('/');
    let mut actual = path.split('/');
    loop {
        match (expected.next(), actual.next()) {
            (None, None) => return Ok(Some(parameters)),
            (Some(pattern), Some(part)) => {
                if let Some(key) = pattern
                    .strip_prefix('{')
                    .and_then(|value| value.strip_suffix('}'))
                {
                    if part.is_empty() {
                        return Ok(None);
                    }
                    parameters.insert(key.to_owned(), decode(part)?);
                } else if pattern != part {
                    return Ok(None);
                }
            }
            _ => return Ok(None),
        }
    }
}
pub fn select<Id: Key>(
    declarations: impl IntoIterator<Item = &'static Operation<Id>>,
    method: &Method,
    path: &str,
) -> Result<Selection<Id>> {
    let mut found = false;
    for operation in declarations {
        if let Some(parameters) = matches(operation.path, path)? {
            found = true;
            let expected = match operation.method {
                operations::Method::Get => Method::GET,
                operations::Method::Post => Method::POST,
                operations::Method::Put => Method::PUT,
                operations::Method::Patch => Method::PATCH,
                operations::Method::Delete => Method::DELETE,
            };
            if method != expected {
                continue;
            }
            return Ok(Selection {
                operation,
                parameters,
            });
        }
    }
    Err(Failure::new(
        if found {
            ErrorCode::MethodNotAllowed
        } else {
            ErrorCode::Missing
        },
        if found {
            "Method not allowed"
        } else {
            "Route not found"
        },
    ))
}
