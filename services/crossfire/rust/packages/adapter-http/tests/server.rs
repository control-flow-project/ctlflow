use crossfire_adapter_http::server::{
    self, Body, Incoming, Limits, Listener, Peer, Request, Response,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{os::unix::fs::PermissionsExt, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, UnixStream},
};
use tokio_util::sync::CancellationToken;
async fn handler(
    _state: Arc<()>,
    request: Request<Incoming>,
    peer: Peer,
) -> Result<Response<Body>> {
    if request.uri().path() == "/fail" {
        return Err(Failure::new(ErrorCode::Forbidden, "Denied"));
    }
    if request.uri().path() == "/deadline" {
        std::future::pending::<()>().await;
    }
    let input = if request.method() == server::Method::POST {
        server::json(request.into_body(), 8).await?
    } else {
        serde_json::json!({})
    };
    let mut response=Response::new(server::full(serde_json::json!({"input":input,"peer":match peer{Peer::Tcp(_)=>"tcp",Peer::Unix(_)=>"unix"}}).to_string()));
    *response.status_mut() = server::StatusCode::CREATED;
    Ok(response)
}
#[tokio::test]
async fn real_http_accepts_tcp_and_bounds_body_failure_and_deadline_without_polling()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let base = format!("http://{}", listener.local_addr()?);
    let stop = CancellationToken::new();
    let task = tokio::spawn(server::serve(
        Listener::Tcp(listener),
        Arc::new(()),
        handler,
        Limits {
            connections: 4,
            idle: Duration::from_secs(1),
            request: Duration::from_millis(100),
        },
        stop.clone(),
    ));
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()?;
    let reply = client.get(format!("{base}/")).send().await?;
    assert_eq!(reply.status().as_u16(), 201);
    assert_eq!(reply.json::<serde_json::Value>().await?["peer"], "tcp");
    let reply = client
        .post(format!("{base}/"))
        .body("{\"x\":1}")
        .send()
        .await?;
    assert_eq!(reply.status().as_u16(), 201);
    assert_eq!(reply.json::<serde_json::Value>().await?["input"]["x"], 1);
    let reply = client
        .post(format!("{base}/"))
        .body("{\"xxxxxxxx\":1}")
        .send()
        .await?;
    assert_eq!(reply.status().as_u16(), 413);
    assert_eq!(
        reply.json::<serde_json::Value>().await?["error"]["code"],
        "body_too_large"
    );
    let reply = client.get(format!("{base}/fail")).send().await?;
    assert_eq!(reply.status().as_u16(), 403);
    assert_eq!(
        reply
            .headers()
            .get("x-content-type-options")
            .ok_or("Header")?,
        "nosniff"
    );
    assert!(reply.headers().get("x-request-id").is_some());
    assert_eq!(
        reply.json::<serde_json::Value>().await?["error"]["message"],
        "Denied"
    );
    let reply = client.get(format!("{base}/deadline")).send().await?;
    assert_eq!(reply.status().as_u16(), 503);
    assert_eq!(
        reply.json::<serde_json::Value>().await?["error"]["code"],
        "unavailable"
    );
    stop.cancel();
    tokio::time::timeout(Duration::from_secs(6), task).await???;
    Ok(())
}
#[tokio::test]
async fn the_same_http_owner_serves_private_unix_peers_and_closes_every_owned_connection()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
    let path = directory.path().join("api.sock");
    let listener = server::private_unix(&path)?;
    let stop = CancellationToken::new();
    let task = tokio::spawn(server::serve(
        Listener::Unix(listener),
        Arc::new(()),
        handler,
        Limits::default(),
        stop.clone(),
    ));
    let socket = crossfire_adapter_filesystem::socket::Socket::open(&path)?;
    let mut stream = UnixStream::connect(socket.endpoint()).await?;
    stream
        .write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
        .await?;
    let mut response = Vec::new();
    tokio::time::timeout(
        Duration::from_secs(2),
        stream.take(4096).read_to_end(&mut response),
    )
    .await??;
    let text = std::str::from_utf8(&response)?;
    assert!(text.starts_with("HTTP/1.1 201"));
    assert!(text.contains("\"peer\":\"unix\""));
    stop.cancel();
    tokio::time::timeout(Duration::from_secs(6), task).await???;
    Ok(())
}
