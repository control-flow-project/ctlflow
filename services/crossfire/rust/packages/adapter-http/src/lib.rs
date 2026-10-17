use crossfire_contracts::validation::whitespace;
pub mod operation;
pub mod proxy;
pub mod routing;
pub mod server;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use reqwest::{Client, Method, Url};
use serde_json::Value;
use std::{path::Path, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

pub const MAX_JSON_BYTES: usize = 1024 * 1024;
#[derive(Clone, Copy)]
pub struct JsonLimits {
    pub request_bytes: usize,
    pub response_bytes: usize,
    pub timeout: Duration,
}
impl Default for JsonLimits {
    fn default() -> Self {
        Self {
            request_bytes: MAX_JSON_BYTES,
            response_bytes: MAX_JSON_BYTES,
            timeout: Duration::from_secs(15),
        }
    }
}
#[derive(Clone)]
pub struct NativeHttp {
    client: Client,
    origin: Url,
    cancellation: CancellationToken,
    socket: Option<Arc<crossfire_adapter_filesystem::socket::Socket>>,
}

pub struct NativeResponse {
    pub status: u16,
    pub body: Value,
}
enum Payload<'a> {
    Json(Option<&'a Value>),
    Binary(bytes::Bytes),
}

impl NativeHttp {
    pub fn new(endpoint: &str, cancellation: CancellationToken) -> Result<Self> {
        Self::configured(endpoint, None, cancellation)
    }
    pub fn unix(path: &Path, cancellation: CancellationToken) -> Result<Self> {
        let socket = Arc::new(crossfire_adapter_filesystem::socket::Socket::open(path)?);
        Self::configured("http://localhost", Some(socket), cancellation)
    }
    fn configured(
        endpoint: &str,
        socket: Option<Arc<crossfire_adapter_filesystem::socket::Socket>>,
        cancellation: CancellationToken,
    ) -> Result<Self> {
        let origin = crossfire_contracts::origin::parse(endpoint)?;
        let mut builder = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .pool_max_idle_per_host(16)
            .connect_timeout(Duration::from_secs(10));
        if let Some(bundle) = std::env::var_os("SSL_CERT_FILE") {
            let path = std::fs::canonicalize(bundle).map_err(|_| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Configured TLS authority bundle is unavailable",
                )
            })?;
            let directory =
                crossfire_adapter_filesystem::assets::Directory::open(path.parent().ok_or_else(
                    || Failure::new(ErrorCode::Invalid, "Invalid TLS authority bundle"),
                )?)?;
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Invalid, "Invalid TLS authority bundle path")
                })?;
            let file = directory.file(name, 1048576)?.ok_or_else(|| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Configured TLS authority bundle is missing",
                )
            })?;
            let certificates = reqwest::Certificate::from_pem_bundle(&file.read(1048576)?)
                .map_err(|_| {
                    Failure::new(ErrorCode::Invalid, "Invalid TLS PEM authority bundle")
                })?;
            if certificates.is_empty() {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "TLS authority bundle contains no certificates",
                ));
            }
            for certificate in certificates {
                builder = builder.add_root_certificate(certificate);
            }
        }
        if let Some(socket) = &socket {
            builder = builder.unix_socket(socket.endpoint());
        }
        let client = builder.build().map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Cannot create bounded native HTTP transport",
            )
        })?;
        Ok(Self {
            client,
            origin,
            cancellation,
            socket,
        })
    }

    pub async fn probe(&self, path: &str, host: &str, timeout: Duration) -> Result<u16> {
        if let Some(socket) = &self.socket {
            socket.validate()?;
        }
        if !path.starts_with('/')
            || path.starts_with("//")
            || path.contains(['#', '\\'])
            || !(Duration::from_millis(100)..=Duration::from_secs(120)).contains(&timeout)
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid HTTP readiness probe",
            ));
        }
        let destination = self
            .origin
            .join(path)
            .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid HTTP readiness probe"))?;
        if destination.origin() != self.origin.origin() {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Probe must remain on its configured origin",
            ));
        }
        let request = self
            .client
            .get(destination)
            .header("host", host)
            .timeout(timeout);
        let response = tokio::select! { biased;
            _ = self.cancellation.cancelled() => return Err(Failure::new(ErrorCode::Native, "HTTP readiness probe cancelled")),
            response = request.send() => response.map_err(transport_failure)?,
        };
        Ok(response.status().as_u16())
    }

    pub async fn json(
        &self,
        token: Option<&Secret>,
        method: Method,
        path: &str,
        body: Option<&Value>,
        limits: JsonLimits,
    ) -> Result<NativeResponse> {
        self.execute(token, method, path, Payload::Json(body), limits)
            .await
    }

    pub async fn binary(
        &self,
        token: Option<&Secret>,
        method: Method,
        path: &str,
        body: bytes::Bytes,
        limits: JsonLimits,
    ) -> Result<NativeResponse> {
        self.execute(token, method, path, Payload::Binary(body), limits)
            .await
    }

    async fn execute(
        &self,
        token: Option<&Secret>,
        method: Method,
        path: &str,
        body: Payload<'_>,
        limits: JsonLimits,
    ) -> Result<NativeResponse> {
        if let Some(socket) = &self.socket {
            socket.validate()?;
        }
        let maximum = limits.response_bytes;
        let timeout = limits.timeout;
        if maximum == 0
            || maximum > 64 * MAX_JSON_BYTES
            || limits.request_bytes > 64 * MAX_JSON_BYTES
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid HTTP response resource bound",
            ));
        }
        if ![
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
        ]
        .contains(&method)
            || timeout < Duration::from_millis(100)
            || timeout > Duration::from_secs(120)
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
        let content_type = match &body {
            Payload::Json(_) => "application/json",
            Payload::Binary(_) => "application/octet-stream",
        };
        let mut request = self
            .client
            .request(method, destination)
            .header("content-type", content_type)
            .timeout(timeout);
        if let Some(token) = token {
            request = request.bearer_auth(token.expose());
        }
        match body {
            Payload::Json(Some(body)) => {
                validate_json(body)
                    .map_err(|_| Failure::new(ErrorCode::Invalid, "Invalid HTTP JSON request"))?;
                let mut encoded = crossfire_kernel::bytes::Buffer::new(limits.request_bytes);
                serde_json::to_writer(&mut encoded, body).map_err(|_| {
                    Failure::new(
                        ErrorCode::BodyTooLarge,
                        "HTTP JSON request exceeds its operation bound",
                    )
                })?;
                request = request.body(encoded.into_vec());
            }
            Payload::Json(None) => {}
            Payload::Binary(body) => {
                if body.len() > limits.request_bytes {
                    return Err(Failure::new(
                        ErrorCode::BodyTooLarge,
                        "HTTP binary request exceeds its operation bound",
                    ));
                }
                request = request.body(body);
            }
        }
        let opened = tokio::select! {
            biased;
            _ = self.cancellation.cancelled() => return Err(Failure::new(ErrorCode::Native, "HTTP request failed or exceeded its deadline")),
            response = request.send() => response.map_err(transport_failure)?,
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
            .json(token, method, path, body, JsonLimits::default())
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
                .map(|code| format!(": {}", crossfire_kernel::text::truncate_utf16(code, 80)))
                .unwrap_or_default();
            return Err(Failure::new(
                ErrorCode::Native,
                format!("Native HTTP {}{code}", response.status),
            ));
        }
        Ok(response.body)
    }
}

fn transport_failure(error: reqwest::Error) -> Failure {
    use std::error::Error;
    let error = error.without_url();
    let mut details = error.to_string();
    let mut source = error.source();
    for _ in 0..4 {
        let Some(error) = source else {
            break;
        };
        details.push_str(": ");
        details.push_str(&error.to_string());
        source = error.source();
    }
    Failure::new(
        ErrorCode::Native,
        format!(
            "HTTP transport failed: {}",
            crossfire_kernel::text::truncate_utf16(&details, 512)
        ),
    )
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
