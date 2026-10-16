use crate::configuration;
use crossfire_adapter_http::NativeHttp;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{path::Path, time::Duration};
use tokio_util::sync::CancellationToken;

pub async fn verify(host: &str, port: u16, stop: CancellationToken) -> Result<()> {
    let http = NativeHttp::new(&format!("http://127.0.0.1:{port}"), stop)?;
    for path in ["/api/health", "/_matrix/client/versions"] {
        let status = http.probe(path, host, Duration::from_secs(3)).await?;
        if status != 200 {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                format!("Container readiness failed: {path} returned {status}"),
            ));
        }
    }
    Ok(())
}
pub async fn run(stop: CancellationToken) -> Result<()> {
    let config = configuration::load(Path::new("/runtime"))?;
    let host = &config.public_origin[url::Position::BeforeHost..url::Position::AfterPort];
    verify(host, 8080, stop).await
}
