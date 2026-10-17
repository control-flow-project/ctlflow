use crate::{request, security, state::State};
use bytes::Bytes;
use crossfire_adapter_http::server::{self, Body, Incoming, Method, Request, Response, header};
use crossfire_domain::{
    port::RepositoryAccess,
    publication::{
        port::{BinarySource, PublicationRepository, PublicationStore},
        validation,
        values::{File, Publication},
    },
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use futures_util::stream;
use http_body_util::{BodyExt, StreamBody};
use hyper::body::Frame;
use std::{sync::Arc, time::Duration};
use tokio::time::Instant;

pub const SECURITY_POLICY: &str = "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

fn unavailable() -> Failure {
    Failure::new(ErrorCode::Unavailable, "Public report read failed")
}
fn response(status: u16, body: Body) -> Result<Response<Body>> {
    Response::builder()
        .status(status)
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_SECURITY_POLICY, SECURITY_POLICY)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header("referrer-policy", "no-referrer")
        .header(
            "permissions-policy",
            "camera=(), microphone=(), geolocation=(), payment=()",
        )
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header("cross-origin-resource-policy", "cross-origin")
        .body(body)
        .map_err(|_| unavailable())
}
fn location(path: &str) -> Option<(&str, &str)> {
    let (key, file) = path.strip_prefix('/')?.split_once('/')?;
    (key.len() == 43
        && key
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-' || value == b'_')
        && validation::path(file).is_ok())
    .then_some((key, file))
}
fn current(
    state: &State,
    key: &str,
    path: &str,
    publication: &Publication,
    file: &File,
) -> Result<()> {
    let actual = state
        .repository
        .with(|repository| repository.public_file(key, path))?;
    if actual.as_ref().is_some_and(|(present, actual)| {
        present.id == publication.id && present.revision == publication.revision && actual == file
    }) {
        Ok(())
    } else {
        Err(Failure::new(
            ErrorCode::Missing,
            "Report is no longer available",
        ))
    }
}
pub async fn handle(state: Arc<State>, input: Request<Incoming>) -> Result<Response<Body>> {
    if security::host(input.headers(), &state.configuration.content_origin).is_err() {
        return response(421, server::empty());
    }
    if ![Method::GET, Method::HEAD, Method::OPTIONS].contains(input.method()) {
        let mut reply = response(405, server::empty())?;
        reply.headers_mut().insert(
            header::ALLOW,
            hyper::header::HeaderValue::from_static("GET, HEAD, OPTIONS"),
        );
        return Ok(reply);
    }
    let path = match request::path(&input) {
        Ok(path) => path,
        Err(_) => return response(404, server::empty()),
    };
    let Some((key, path)) = location(path) else {
        return response(404, server::empty());
    };
    let record = state
        .repository
        .with(|repository| repository.public_file(key, path));
    let (publication, file) = match record {
        Ok(Some(record)) => record,
        Ok(None) => return response(404, server::empty()),
        Err(_) => return response(503, server::empty()),
    };
    if input.method() == Method::OPTIONS {
        return response(204, server::empty());
    }
    let Ok(permit) = Arc::clone(&state.public_reads).try_acquire_owned() else {
        return response(503, server::empty());
    };
    let reader = match state.publications.read(&publication.id, &file) {
        Ok(reader) => reader,
        Err(_) => return response(503, server::empty()),
    };
    if let Err(error) = current(&state, key, path, &publication, &file) {
        return response(
            if error.code == ErrorCode::Missing {
                404
            } else {
                503
            },
            server::empty(),
        );
    }
    let content_type = hyper::header::HeaderValue::from_str(&file.manifest.media_type)
        .map_err(|_| unavailable())?;
    let length = hyper::header::HeaderValue::from_str(&file.manifest.bytes.to_string())
        .map_err(|_| unavailable())?;
    let body = if input.method() == Method::HEAD {
        server::empty()
    } else {
        let key = key.to_owned();
        let path = path.to_owned();
        let deadline = Instant::now() + Duration::from_secs(30);
        let source = (
            reader,
            state,
            key,
            path,
            publication,
            file,
            permit,
            deadline,
        );
        let stream = stream::try_unfold(
            source,
            |(mut reader, state, key, path, publication, file, permit, deadline)| async move {
                current(&state, &key, &path, &publication, &file)?;
                let chunk = tokio::select! {
                    biased;
                    _ = state.stop.cancelled() => return Err(unavailable()),
                    value = tokio::time::timeout_at(deadline, reader.next()) => value.map_err(|_| unavailable())??,
                };
                current(&state, &key, &path, &publication, &file)?;
                Ok(chunk.map(|chunk| {
                    (
                        Frame::data(Bytes::from(chunk)),
                        (
                            reader,
                            state,
                            key,
                            path,
                            publication,
                            file,
                            permit,
                            deadline,
                        ),
                    )
                }))
            },
        );
        StreamBody::new(stream).boxed_unsync()
    };
    let mut reply = response(200, body)?;
    reply
        .headers_mut()
        .insert(header::CONTENT_TYPE, content_type);
    reply.headers_mut().insert(header::CONTENT_LENGTH, length);
    Ok(reply)
}
