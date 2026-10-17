use crossfire_contracts::operations::Method;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::Value;
use std::{collections::BTreeMap, future::Future};
use tokio_util::sync::CancellationToken;

pub const API: &str = "/_matrix/client/v3";
pub const HISTORY_BYTES: usize = 64 * 1024 * 1024;
pub struct Request {
    pub method: Method,
    pub path: String,
    pub query: BTreeMap<String, String>,
    pub body: Option<Value>,
    pub maximum_bytes: usize,
}
impl Request {
    pub fn new(method: Method, path: impl Into<String>) -> Self {
        Self {
            method,
            path: path.into(),
            query: BTreeMap::new(),
            body: None,
            maximum_bytes: 1024 * 1024,
        }
    }
}
pub struct Response {
    pub status: u16,
    pub body: Value,
}
pub trait Matrix: Send + Sync {
    fn request(
        &self,
        request: &Request,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<Response>> + Send;
}
pub async fn request(
    matrix: &impl Matrix,
    request: &Request,
    stop: CancellationToken,
) -> Result<Value> {
    let response = matrix.request(request, stop).await?;
    if (200..300).contains(&response.status) {
        return Ok(response.body);
    }
    let native_code = response
        .body
        .get("errcode")
        .and_then(Value::as_str)
        .filter(|code| {
            code.len() <= 100
                && code
                    .bytes()
                    .all(|value| value.is_ascii_uppercase() || value == b'_')
        })
        .unwrap_or("M_UNKNOWN");
    let code = match response.status {
        401 => ErrorCode::Unauthorized,
        403 => ErrorCode::Forbidden,
        404 => ErrorCode::Missing,
        413 => ErrorCode::BodyTooLarge,
        _ => ErrorCode::Native,
    };
    Err(Failure::new(
        code,
        format!("Native Matrix HTTP {} ({native_code})", response.status),
    ))
}
