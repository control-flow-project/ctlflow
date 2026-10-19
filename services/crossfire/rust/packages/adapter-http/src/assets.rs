use crate::server::{self, Body, Response, header};
use bytes::Bytes;
use crossfire_adapter_filesystem::assets::{Asset, Directory};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use futures_util::stream;
use http_body_util::{BodyExt, StreamBody};
use hyper::body::Frame;
use std::time::Duration;
use tokio::{io::AsyncReadExt, time::Instant};
use tokio_util::sync::CancellationToken;

fn missing() -> Failure {
    Failure::new(ErrorCode::Missing, "Asset not found")
}
fn open(root: &Directory, name: &str) -> Result<Asset> {
    root.file(name, 64 * 1024 * 1024)
        .map_err(|error| {
            if error.code == ErrorCode::Invalid {
                missing()
            } else {
                error
            }
        })?
        .ok_or_else(missing)
}
fn media_type(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        _ => "application/octet-stream",
    }
}
pub fn bytes(
    bytes: impl Into<Bytes>,
    content_type: &str,
    cache: &str,
    head: bool,
) -> Result<Response<Body>> {
    let bytes = bytes.into();
    Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, bytes.len())
        .header(header::CACHE_CONTROL, cache)
        .header("x-content-type-options", "nosniff")
        .header(
            "content-security-policy",
            "default-src 'none'; frame-ancestors 'none'",
        )
        .body(if head {
            server::empty()
        } else {
            server::full(bytes)
        })
        .map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Asset response cannot be constructed",
            )
        })
}
pub fn serve(
    root: &Directory,
    path: &str,
    head: bool,
    stop: CancellationToken,
) -> Result<Response<Body>> {
    let mut name = path.trim_start_matches('/').to_owned();
    if name.is_empty() || name.ends_with('/') {
        name.push_str("index.html");
    }
    let file = open(root, &name)?;
    let info = file.metadata()?;
    let file = tokio::fs::File::from_std(file.into_file());
    let deadline = Instant::now() + Duration::from_secs(30);
    let body = if head {
        server::empty()
    } else {
        let stream = stream::try_unfold(
            (file, info.len(), stop, deadline),
            |(mut file, remaining, stop, deadline)| async move {
                if remaining == 0 {
                    return Ok(None);
                }
                let mut bytes = vec![0u8; remaining.min(65536) as usize];
                let count = tokio::select! {biased;_=stop.cancelled()=>return Err(Failure::new(ErrorCode::Unavailable,"Asset serving stopped")),value=tokio::time::timeout_at(deadline,file.read(&mut bytes))=>value.map_err(|_|Failure::new(ErrorCode::Unavailable,"Asset read exceeded its deadline"))?.map_err(|_|Failure::new(ErrorCode::Unavailable,"Asset read failed"))?};
                if count == 0 {
                    return Err(Failure::new(
                        ErrorCode::Unavailable,
                        "Asset changed during its read",
                    ));
                }
                bytes.truncate(count);
                Ok(Some((
                    Frame::data(Bytes::from(bytes)),
                    (file, remaining - count as u64, stop, deadline),
                )))
            },
        );
        StreamBody::new(stream).boxed_unsync()
    };
    Response::builder()
        .status(200)
        .header(header::CONTENT_TYPE, media_type(&name))
        .header(header::CONTENT_LENGTH, info.len())
        .header(
            header::CACHE_CONTROL,
            if name.ends_with(".html") {
                "no-cache"
            } else {
                "public, max-age=3600"
            },
        )
        .header("x-content-type-options", "nosniff")
        .body(body)
        .map_err(|_| {
            Failure::new(
                ErrorCode::Unavailable,
                "Asset response cannot be constructed",
            )
        })
}
