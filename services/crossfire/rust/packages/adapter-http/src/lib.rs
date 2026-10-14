use crossfire_contracts::validation::whitespace;
pub mod server;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use reqwest::{Client, Method, Url};
use serde_json::Value;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub const MAX_JSON_BYTES: usize = 1024 * 1024;

pub fn origin(value: &str) -> Result<Url> {
    let endpoint =
        Url::parse(value).map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid server origin"))?;
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

#[derive(Clone)]
pub struct NativeHttp {
    client: Client,
    origin: Url,
    cancellation: CancellationToken,
}

pub struct NativeResponse {
    pub status: u16,
    pub body: Value,
}

impl NativeHttp {
    pub fn new(endpoint: &str, cancellation: CancellationToken) -> Result<Self> {
        let origin = origin(endpoint)?;
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .pool_max_idle_per_host(16)
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Cannot create bounded native HTTP transport",
                )
            })?;
        Ok(Self {
            client,
            origin,
            cancellation,
        })
    }

    pub async fn json(
        &self,
        token: Option<&Secret>,
        method: Method,
        path: &str,
        body: Option<&Value>,
        maximum: usize,
        timeout: Duration,
    ) -> Result<NativeResponse> {
        if maximum == 0 || maximum > 64 * MAX_JSON_BYTES {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid HTTP response resource bound",
            ));
        }
        if ![Method::GET, Method::POST, Method::PUT, Method::DELETE].contains(&method)
            || timeout < Duration::from_millis(100)
            || timeout > Duration::from_secs(45)
            || !path.starts_with('/')
            || path.starts_with("//")
            || path.len() > 65536
            || path.chars().any(|character| {
                character == '\\'
                    || character == '#'
                    || whitespace(character)
                    || character <= '\u{1f}'
                    || character == '\u{7f}'
            })
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid bounded HTTP request",
            ));
        }
        let destination = Url::parse(&format!(
            "{}{}",
            self.origin.as_str().trim_end_matches('/'),
            path
        ))
        .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid bounded HTTP request"))?;
        if destination.origin() != self.origin.origin()
            || !destination.username().is_empty()
            || destination.password().is_some()
            || destination.fragment().is_some()
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "HTTP request must remain on its configured origin",
            ));
        }
        let mut request = self
            .client
            .request(method, destination)
            .header("content-type", "application/json")
            .timeout(timeout);
        if let Some(token) = token {
            request = request.bearer_auth(token.expose());
        }
        if let Some(body) = body {
            validate_json(body)
                .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid HTTP JSON request"))?;
            let encoded = serde_json::to_vec(body)
                .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid HTTP JSON request"))?;
            if encoded.len() > MAX_JSON_BYTES {
                return Err(Failure::new(ErrorCode::Limit, "HTTP request exceeds 1 MiB"));
            }
            request = request.body(encoded);
        }
        let opened = tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => return Err(Failure::new(ErrorCode::Native, "HTTP request failed or exceeded its deadline")),
            response = request.send() => response.map_err(|_| Failure::new(ErrorCode::Native, "HTTP request failed or exceeded its deadline"))?,
        };
        if opened.status().is_redirection() {
            return Err(Failure::new(
                ErrorCode::Native,
                "HTTP request failed or exceeded its deadline",
            ));
        }
        let status = opened.status().as_u16();
        let collected = self.collect(opened, maximum);
        let bytes = tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => return Err(Failure::new(ErrorCode::Native, "HTTP response is invalid or exceeds its deadline")),
            bytes = collected => bytes?,
        };
        let body: Value = serde_json::from_slice(&bytes).map_err(|_| {
            Failure::new(
                ErrorCode::Native,
                "HTTP response is invalid or exceeds its deadline",
            )
        })?;
        validate_json(&body)
            .map_err(|_| Failure::new(ErrorCode::Native, "Invalid HTTP JSON response"))?;
        Ok(NativeResponse { status, body })
    }

    async fn collect(&self, mut response: reqwest::Response, maximum: usize) -> Result<Vec<u8>> {
        if response
            .content_length()
            .is_some_and(|length| length > maximum as u64)
        {
            return Err(Failure::new(
                ErrorCode::BodyTooLarge,
                "HTTP response exceeds its collection resource bound",
            ));
        }
        let mut bytes =
            Vec::with_capacity(response.content_length().unwrap_or(0).min(maximum as u64) as usize);
        while let Some(chunk) = response.chunk().await.map_err(|_| {
            Failure::new(
                ErrorCode::Native,
                "HTTP response is invalid or exceeds its deadline",
            )
        })? {
            if chunk.len() > maximum - bytes.len() {
                return Err(Failure::new(
                    ErrorCode::BodyTooLarge,
                    "HTTP response exceeds its collection resource bound",
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }

    pub async fn request(
        &self,
        token: Option<&Secret>,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<NativeResponse> {
        let response = self
            .json(
                token,
                method,
                path,
                body,
                MAX_JSON_BYTES,
                Duration::from_secs(15),
            )
            .await?;
        if !response.body.is_object() {
            return Err(Failure::new(
                ErrorCode::Native,
                "Expected a native JSON object",
            ));
        }
        Ok(response)
    }

    pub async fn ok(
        &self,
        token: Option<&Secret>,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value> {
        let response = self.request(token, method, path, body).await?;
        if !(200..300).contains(&response.status) {
            let code = response
                .body
                .get("errcode")
                .and_then(Value::as_str)
                .map(|code| {
                    format!(
                        ": {}",
                        crossfire_contracts::validation::truncate_utf16(code, 80)
                    )
                })
                .unwrap_or_default();
            return Err(Failure::new(
                ErrorCode::Native,
                format!("Native HTTP {}{code}", response.status),
            ));
        }
        Ok(response.body)
    }
}

pub fn validate_json(value: &Value) -> Result<()> {
    fn visit(value: &Value, depth: usize) -> Result<()> {
        if depth > 64 {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "JSON nesting exceeds its bound",
            ));
        }
        match value {
            Value::Array(items) => {
                for item in items {
                    visit(item, depth + 1)?;
                }
            }
            Value::Object(items) => {
                for item in items.values() {
                    visit(item, depth + 1)?;
                }
            }
            Value::Number(number) if number.as_f64().is_none_or(|value| !value.is_finite()) => {
                return Err(Failure::new(ErrorCode::Invalid, "Invalid JSON number"));
            }
            _ => {}
        }
        Ok(())
    }
    visit(value, 0)
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
