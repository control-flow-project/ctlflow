use super::values::*;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::BTreeSet;

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
pub fn path(value: &str) -> Result<()> {
    let valid = !value.is_empty()
        && value.len() <= 240
        && value
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || b"._/-".contains(&value))
        && value.split('/').all(|part| {
            part.len() <= 100
                && !part.ends_with('.')
                && part
                    .bytes()
                    .next()
                    .is_some_and(|first| first.is_ascii_alphanumeric())
        });
    if valid {
        Ok(())
    } else {
        Err(invalid(
            "Use a relative report path with letters, digits, dots, underscores, hyphens and forward slashes",
        ))
    }
}
pub fn media(path: &str) -> Result<&'static str> {
    match path.rsplit('.').next() {
        Some("html") => Ok("text/html"),
        Some("css") => Ok("text/css"),
        Some("js" | "mjs") => Ok("text/javascript"),
        Some("json") => Ok("application/json"),
        Some("txt") => Ok("text/plain"),
        Some("csv") => Ok("text/csv"),
        Some("png") => Ok("image/png"),
        Some("jpg" | "jpeg") => Ok("image/jpeg"),
        Some("gif") => Ok("image/gif"),
        Some("webp") => Ok("image/webp"),
        Some("avif") => Ok("image/avif"),
        Some("svg") => Ok("image/svg+xml"),
        Some("ico") => Ok("image/x-icon"),
        Some("woff") => Ok("font/woff"),
        Some("woff2") => Ok("font/woff2"),
        Some("pdf") => Ok("application/pdf"),
        _ => Err(invalid("Unsupported static report file type")),
    }
}
pub fn manifest(input: &Creation) -> Result<i64> {
    if input.title.trim().is_empty()
        || input.title.encode_utf16().count() > 200
        || input
            .title
            .chars()
            .any(|value| value <= '\u{1f}' || value == '\u{7f}')
        || input.files.is_empty()
        || input.files.len() > MAX_FILES
    {
        return Err(invalid(
            "A title and bounded static file manifest are required",
        ));
    }
    let mut paths = BTreeSet::new();
    let mut total = 0;
    for file in &input.files {
        path(&file.path)?;
        if media(&file.path)? != file.media_type
            || !(0..=MAX_FILE_BYTES).contains(&file.bytes)
            || file.sha256.len() != 64
            || !file
                .sha256
                .bytes()
                .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
        {
            return Err(invalid(
                "File size, MIME type or digest does not match the static manifest",
            ));
        }
        if !paths.insert(file.path.to_ascii_lowercase()) {
            return Err(invalid("Report paths must be unique, including case"));
        }
        total += file.bytes;
    }
    for path in &paths {
        for (index, value) in path.bytes().enumerate() {
            if value == b'/' && paths.contains(&path[..index]) {
                return Err(invalid("A file cannot also be a directory"));
            }
        }
    }
    if !input.files.iter().any(|file| file.path == "index.html") || total > MAX_BUNDLE_BYTES {
        return Err(invalid(
            "A report requires index.html and at most 32 MiB of static files",
        ));
    }
    Ok(total)
}
