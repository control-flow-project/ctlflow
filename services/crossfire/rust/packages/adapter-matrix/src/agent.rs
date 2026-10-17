use crossfire_adapter_http::{JsonLimits, NativeHttp};
use crossfire_agent_core::{
    matrix::{Matrix, Request, Response},
    profile::Profile,
};
use crossfire_contracts::operations::Method;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub struct Client {
    http: NativeHttp,
    credential: Secret,
    request_bytes: usize,
}
impl Client {
    pub fn new(profile: &Profile, stop: CancellationToken) -> Result<Self> {
        Ok(Self {
            http: NativeHttp::new(&profile.settings.homeserver, stop)?,
            credential: profile.account.access_token.clone(),
            request_bytes: profile.settings.max_upload_bytes,
        })
    }
}
impl Matrix for Client {
    async fn request(&self, request: &Request, stop: CancellationToken) -> Result<Response> {
        if !request.path.starts_with("/_matrix/") || request.path.contains('?') {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Native agent requests must remain on the Matrix protocol surface",
            ));
        }
        let mut path = request.path.clone();
        if !request.query.is_empty() {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            for (key, value) in &request.query {
                query.append_pair(key, value);
            }
            path.push('?');
            path.push_str(&query.finish());
        }
        let method = match request.method {
            Method::Get => reqwest::Method::GET,
            Method::Post => reqwest::Method::POST,
            Method::Put => reqwest::Method::PUT,
            Method::Patch => reqwest::Method::PATCH,
            Method::Delete => reqwest::Method::DELETE,
        };
        let response = tokio::select! { biased;
            _ = stop.cancelled() => return Err(Failure::new(ErrorCode::Native, "Native agent request was cancelled")),
            result = self.http.json(Some(&self.credential), method, &path, request.body.as_ref(), JsonLimits { request_bytes: self.request_bytes, response_bytes: request.maximum_bytes, timeout: Duration::from_secs(45) }) => result?,
        };
        Ok(Response {
            status: response.status,
            body: response.body,
        })
    }
}
