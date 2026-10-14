use crossfire_adapter_http::{NativeHttp, origin, segment, validate_json};
use crossfire_kernel::{failure::ErrorCode, secret::Secret};
use reqwest::Method;
use serde_json::{Value, json};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

struct Fixture {
    origin: String,
    task: JoinHandle<()>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn fixture(
    status: &str,
    body: &[u8],
    headers: &str,
) -> std::result::Result<Fixture, Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let origin = format!("http://{}", listener.local_addr()?);
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\n{headers}Connection: close\r\n\r\n",
        body.len()
    );
    let mut response = response.into_bytes();
    response.extend_from_slice(body);
    let task = tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            let mut request = [0_u8; 16384];
            if socket.read(&mut request).await.is_ok() {
                let _sent = socket.write_all(&response).await;
            }
        }
    });
    Ok(Fixture { origin, task })
}

#[tokio::test]
async fn actual_http_enforces_bound_origin_and_redirect_policy()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let fixture = fixture(
        "200 OK",
        br#"{"accepted":true}"#,
        "Content-Type: application/json\r\n",
    )
    .await?;
    let client = NativeHttp::new(&fixture.origin, CancellationToken::new())?;
    let response = client.request(None, Method::GET, "/state", None).await?;
    assert_eq!(response.status, 200);
    assert_eq!(response.body, json!({"accepted":true}));
    assert!(
        client
            .request(None, Method::GET, "//evil.test/path", None)
            .await
            .is_err()
    );
    assert!(
        client
            .request(None, Method::GET, "/bad#fragment", None)
            .await
            .is_err()
    );
    assert!(
        client
            .request(None, Method::GET, "/bad\npath", None)
            .await
            .is_err()
    );
    let fixture = self::fixture("302 Found", b"{}", "Location: https://evil.test\r\n").await?;
    let client = NativeHttp::new(&fixture.origin, CancellationToken::new())?;
    assert!(
        client
            .request(None, Method::GET, "/state", None)
            .await
            .is_err()
    );
    Ok(())
}

#[tokio::test]
async fn oversized_invalid_and_cancelled_http_remain_bounded()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let fixture = fixture("200 OK", &[b'x'; 100], "").await?;
    let client = NativeHttp::new(&fixture.origin, CancellationToken::new())?;
    let response = client
        .json(
            None,
            Method::GET,
            "/state",
            None,
            10,
            Duration::from_secs(1),
        )
        .await;
    assert_eq!(
        response.err().map(|error| error.code),
        Some(ErrorCode::BodyTooLarge)
    );
    let fixture = self::fixture("200 OK", &[0xff], "").await?;
    let client = NativeHttp::new(&fixture.origin, CancellationToken::new())?;
    assert!(
        client
            .request(None, Method::GET, "/state", None)
            .await
            .is_err()
    );
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let client = NativeHttp::new(&fixture.origin, cancelled)?;
    assert!(
        client
            .request(None, Method::GET, "/state", None)
            .await
            .is_err()
    );
    Ok(())
}

#[test]
fn origin_json_encoding_and_secrets_are_explicit() {
    assert!(origin("https://server.test").is_ok());
    assert!(origin("http://localhost:8080").is_ok());
    assert!(origin("http://evil.test").is_err());
    assert!(origin("https://user:secret@server.test").is_err());
    assert!(origin("https://server.test/path").is_err());
    assert!(origin("https://server.test?secret=1").is_err());
    assert_eq!(segment("!a:b /🚀"), "!a%3Ab%20%2F%F0%9F%9A%80");
    let secret = Secret::new("must-not-appear".to_owned());
    assert_eq!(format!("{secret:?}"), "[redacted]");
    let mut value = Value::Null;
    for _depth in 0..65 {
        value = json!([value]);
    }
    assert!(validate_json(&value).is_err());
}
