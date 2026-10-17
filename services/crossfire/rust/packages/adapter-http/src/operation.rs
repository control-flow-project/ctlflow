use crate::{JsonLimits, NativeHttp};
use crossfire_contracts::origin::segment;
use crossfire_contracts::{
    call::{Call, Key},
    envelope::{ErrorResponse, Metadata, Response},
    operations::{Authentication, Method},
    validation as check,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use serde_json::{Value, json};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub struct Client {
    http: NativeHttp,
    credential: Option<Secret>,
    timeout: Duration,
    response_bytes: usize,
}
pub struct Reply {
    pub data: Value,
    pub metadata: Metadata,
}
fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
impl Client {
    pub fn new(origin: &str, credential: Option<Secret>, stop: CancellationToken) -> Result<Self> {
        Self::from_http(
            NativeHttp::new(origin, stop)?,
            credential,
            Duration::from_secs(30),
            32 * 1024 * 1024,
        )
    }
    pub fn from_http(
        http: NativeHttp,
        credential: Option<Secret>,
        timeout: Duration,
        response_bytes: usize,
    ) -> Result<Self> {
        if timeout < Duration::from_millis(100)
            || timeout > Duration::from_secs(120)
            || !(1..=32 * 1024 * 1024).contains(&response_bytes)
        {
            return Err(invalid("Invalid operation transport deadline"));
        }
        Ok(Self {
            http,
            credential,
            timeout,
            response_bytes,
        })
    }
    pub async fn call<Id: Key>(&self, call: &Call<Id>, stop: CancellationToken) -> Result<Reply> {
        self.execute(call, None, stop).await
    }
    pub async fn upload<Id: Key>(
        &self,
        call: &Call<Id>,
        bytes: bytes::Bytes,
        stop: CancellationToken,
    ) -> Result<Reply> {
        self.execute(call, Some(bytes), stop).await
    }
    async fn execute<Id: Key>(
        &self,
        call: &Call<Id>,
        binary: Option<bytes::Bytes>,
        stop: CancellationToken,
    ) -> Result<Reply> {
        let declared = call.definition()?;
        if declared.binary != binary.is_some() || binary.is_some() && call.body.is_some() {
            return Err(invalid(
                "Use the operation's declared JSON or binary request kind",
            ));
        }
        let path = target(call)?;
        let method = match declared.method {
            Method::Get => reqwest::Method::GET,
            Method::Post => reqwest::Method::POST,
            Method::Put => reqwest::Method::PUT,
            Method::Patch => reqwest::Method::PATCH,
            Method::Delete => reqwest::Method::DELETE,
        };
        if method == reqwest::Method::GET
            && call
                .body
                .as_ref()
                .is_some_and(|value| value.as_object().is_none_or(|value| !value.is_empty()))
        {
            return Err(invalid("GET operations have no request body"));
        }
        let empty = json!({});
        let body = (method != reqwest::Method::GET).then_some(call.body.as_ref().unwrap_or(&empty));
        let token = if declared.auth == Authentication::Public {
            None
        } else {
            self.credential.as_ref()
        };
        let request = async {
            let limits = JsonLimits {
                request_bytes: declared.request_bytes,
                response_bytes: self.response_bytes,
                timeout: self.timeout,
            };
            match binary {
                Some(bytes) => self.http.binary(token, method, &path, bytes, limits).await,
                None => self.http.json(token, method, &path, body, limits).await,
            }
        };
        let response = tokio::select! { biased;
            _ = stop.cancelled() => return Err(Failure::new(ErrorCode::Unavailable, "Coordination request was cancelled")),
            result = request => result.map_err(|mut error| { if error.code == ErrorCode::Native { error.code = ErrorCode::Unavailable; } error })?,
        };
        decode(
            response.status,
            response.body,
            declared.status,
            declared.collection,
        )
    }
}
pub fn target<Id: Key>(call: &Call<Id>) -> Result<String> {
    let declared = call.definition()?;
    let parts = call.path_parts()?;
    let path = declared
        .path
        .split('/')
        .zip(parts)
        .map(|(template, part)| {
            if template.starts_with('{') {
                segment(&part)
            } else {
                part
            }
        })
        .collect::<Vec<_>>()
        .join("/");
    if call.query.is_empty() {
        Ok(path)
    } else {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        for (key, value) in &call.query {
            query.append_pair(key, value);
        }
        Ok(format!("{path}?{}", query.finish()))
    }
}
fn metadata(value: &Value, collection: bool) -> Result<Metadata> {
    let data = check::object(
        value,
        &["requestId"],
        &["page", "pageSize", "totalItems", "totalPages"],
    )?;
    check::identifier(&data["requestId"])?;
    for name in ["page", "pageSize", "totalItems", "totalPages"] {
        if let Some(value) = data.get(name) {
            check::integer(
                value,
                if ["page", "pageSize", "totalPages"].contains(&name) {
                    1
                } else {
                    0
                },
                if name == "pageSize" { 100 } else { i64::MAX },
            )?;
        } else if collection {
            return Err(invalid("Collection metadata is incomplete"));
        }
    }
    serde_json::from_value(value.clone()).map_err(|_| invalid("Invalid operation metadata"))
}
pub fn decode(status: u16, value: Value, expected: u16, collection: bool) -> Result<Reply> {
    if status != expected {
        let fields = check::object(&value, &["error", "meta"], &[])?;
        metadata(&fields["meta"], false)?;
        let decoded: ErrorResponse = serde_json::from_value(value)
            .map_err(|_| invalid("Invalid operation failure envelope"))?;
        return Err(decoded.error);
    }
    let fields = check::object(&value, &["data", "meta"], &[])?;
    let metadata = metadata(&fields["meta"], collection)?;
    if collection && !fields["data"].is_array() {
        return Err(invalid("A collection requires an array"));
    }
    let decoded: Response<Value> = serde_json::from_value(value)
        .map_err(|_| invalid("Invalid operation response envelope"))?;
    Ok(Reply {
        data: decoded.data,
        metadata,
    })
}
