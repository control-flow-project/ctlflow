use crate::{
    NativeHttp,
    server::{Body, Incoming, Request, Response},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use futures_util::{TryStreamExt, stream};
use http_body_util::{BodyExt, Limited, StreamBody};
use hyper::{HeaderMap, Method, body::Frame, header};
use std::{collections::BTreeSet, time::Duration};
const MAXIMUM_REQUEST: usize = 64 * 1024 * 1024;
fn failed() -> Failure {
    Failure::new(
        ErrorCode::Native,
        "HTTP forwarding failed or exceeded its deadline",
    )
}
fn exclusions(headers: &HeaderMap) -> BTreeSet<String> {
    let mut excluded: [&str; 10] = [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "cookie",
        "set-cookie",
    ];
    excluded.sort_unstable();
    let mut result = excluded
        .into_iter()
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    for connection in headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
    {
        result.extend(
            connection
                .split(',')
                .map(|value| value.trim().to_ascii_lowercase()),
        );
    }
    result
}

impl NativeHttp {
    pub async fn forward(
        &self,
        input: Request<Incoming>,
        public_host: &str,
    ) -> Result<Response<Body>> {
        let method = input.method().clone();
        if ![
            Method::GET,
            Method::HEAD,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ]
        .contains(&method)
        {
            return Err(Failure::new(
                ErrorCode::MethodNotAllowed,
                "Unsupported HTTP method",
            ));
        }
        let path = input
            .uri()
            .path_and_query()
            .map(|value| value.as_str())
            .ok_or_else(failed)?;
        if !path.starts_with('/')
            || path.starts_with("//")
            || path
                .chars()
                .any(|value| value <= '\u{20}' || value == '\u{7f}' || matches!(value, '\\' | '#'))
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid HTTP forwarding target",
            ));
        }
        let destination = reqwest::Url::parse(&format!(
            "{}{}",
            self.origin.as_str().trim_end_matches('/'),
            path
        ))
        .map_err(|_| failed())?;
        if destination.origin() != self.origin.origin()
            || destination.username() != ""
            || destination.password().is_some()
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "HTTP forwarding must remain on its configured origin",
            ));
        }
        if input
            .headers()
            .get(header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| {
                value
                    .parse::<u64>()
                    .map_or(true, |value| value > MAXIMUM_REQUEST as u64)
            })
        {
            return Err(Failure::new(
                ErrorCode::BodyTooLarge,
                "Request body exceeds the configured bound",
            ));
        }
        let excluded = exclusions(input.headers());
        let has_body = input.headers().contains_key(header::CONTENT_LENGTH)
            || input.headers().contains_key(header::TRANSFER_ENCODING);
        let mut request = self
            .client
            .request(method.clone(), destination)
            .timeout(Duration::from_secs(110));
        for (name, value) in input.headers() {
            if excluded.contains(name.as_str())
                || name == header::HOST
                || name.as_str() == "forwarded"
                || name.as_str().starts_with("x-forwarded-")
            {
                continue;
            }
            request = request.header(name, value);
        }
        request = request.header(header::HOST, public_host);
        if has_body {
            let body = Limited::new(input.into_body(), MAXIMUM_REQUEST)
                .into_data_stream()
                .map_err(|_| failed());
            request = request.body(reqwest::Body::wrap_stream(body));
        }
        let response = tokio::select! {biased;_=self.cancellation.cancelled()=>return Err(failed()),response=request.send()=>response.map_err(|_|failed())?};
        if response.status().is_redirection()
            && response.status() != hyper::StatusCode::NOT_MODIFIED
        {
            return Err(failed());
        }
        let status = response.status();
        let mut builder = Response::builder().status(status);
        let excluded = exclusions(response.headers());
        for (name, value) in response.headers() {
            if !excluded.contains(name.as_str()) && name != header::SET_COOKIE {
                builder = builder.header(name, value);
            }
        }
        if method == Method::HEAD
            || status == hyper::StatusCode::NO_CONTENT
            || status == hyper::StatusCode::NOT_MODIFIED
        {
            return builder.body(crate::server::empty()).map_err(|_| failed());
        }
        let body = stream::try_unfold(
            (response, self.cancellation.clone()),
            |(mut response, stop)| async move {
                let bytes = tokio::select! {biased;_=stop.cancelled()=>return Err(failed()),bytes=response.chunk()=>bytes.map_err(|_|failed())?};
                Ok(bytes.map(|bytes| (Frame::data(bytes), (response, stop))))
            },
        );
        builder
            .body(StreamBody::new(body).boxed_unsync())
            .map_err(|_| failed())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_forwarding_excludes_cookies_and_connection_named_headers() {
        let mut headers = hyper::HeaderMap::new();
        headers.insert(
            hyper::header::CONNECTION,
            hyper::header::HeaderValue::from_static("x-private"),
        );
        let excluded = super::exclusions(&headers);
        for name in [
            "cookie",
            "set-cookie",
            "x-private",
            "connection",
            "transfer-encoding",
        ] {
            assert!(excluded.contains(name), "{name}");
        }
        assert!(!excluded.contains("authorization"));
    }
}
