use bytes::Bytes;
use crossfire_adapter_filesystem::assets::{Asset, Directory};
use crossfire_adapter_http::server::{self, Body, Response, header};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use futures_util::stream;
use http_body_util::{BodyExt, StreamBody};
use hyper::body::Frame;
use std::{path::Path, time::Duration};
use tokio::{io::AsyncReadExt, time::Instant};
use tokio_util::sync::CancellationToken;

pub struct Assets {
    pub web: Directory,
    pub element: Directory,
    pub presentation: serde_json::Value,
}
impl Assets {
    pub fn load(web: &Path, element: &Path, host: &str) -> Result<Self> {
        let web = Directory::open(web)?;
        let element = Directory::open(element)?;
        open(&web, "index.html")?;
        open(&element, "index.html")?;
        let presentation = element
            .file(&format!("config.{host}.json"), 65536)?
            .map(|file| {
                let value: serde_json::Value =
                    serde_json::from_slice(&file.read(65536)?).map_err(|_| {
                        Failure::new(
                            ErrorCode::Invalid,
                            "Invalid Element presentation configuration",
                        )
                    })?;
                let Some(object) = value.as_object() else {
                    return Err(Failure::new(
                        ErrorCode::Invalid,
                        "Invalid Element presentation configuration",
                    ));
                };
                let result = object
                    .iter()
                    .filter(|(key, _)| {
                        [
                            "brand",
                            "default_theme",
                            "branding",
                            "embedded_pages",
                            "setting_defaults",
                        ]
                        .contains(&key.as_str())
                    })
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect::<serde_json::Map<_, _>>();
                Ok(serde_json::Value::Object(result))
            })
            .transpose()?
            .unwrap_or_else(|| serde_json::json!({}));
        Ok(Self {
            web,
            element,
            presentation,
        })
    }
}
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
