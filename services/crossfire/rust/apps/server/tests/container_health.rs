use crossfire_server::container_health;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn loopback_probes_check_both_headers_without_redirects_or_body_collection()
-> Result<(), Box<dyn std::error::Error>> {
    let host = "verification.localhost:55000";
    for status in [200, 302, 503] {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        let server = tokio::spawn(async move {
            let mut requests = Vec::new();
            for path in ["/api/health", "/_matrix/client/versions"] {
                let (mut socket, _) = listener.accept().await?;
                let mut bytes = Vec::new();
                while !bytes.ends_with(b"\r\n\r\n") {
                    if bytes.len() >= 8192 {
                        return Err(std::io::Error::other("bounded request headers"));
                    }
                    bytes.push(socket.read_u8().await?);
                }
                let request = String::from_utf8(bytes).map_err(std::io::Error::other)?;
                assert!(request.starts_with(&format!("GET {path} HTTP/1.1\r\n")));
                assert!(
                    request
                        .to_ascii_lowercase()
                        .contains(&format!("\r\nhost: {host}\r\n"))
                );
                requests.push(path);
                let selected = if path == "/api/health" { 200 } else { status };
                socket.write_all(format!("HTTP/1.1 {selected} Probe\r\nLocation: /must-not-follow\r\nContent-Length: 1000000000\r\nConnection: close\r\n\r\n").as_bytes()).await?;
            }
            Ok::<_, std::io::Error>(requests)
        });
        let result = container_health::verify(host, port, CancellationToken::new()).await;
        assert_eq!(result.is_ok(), status == 200);
        if let Err(error) = result {
            assert!(error.message.contains(&status.to_string()));
        }
        assert_eq!(server.await??, ["/api/health", "/_matrix/client/versions"]);
    }
    let stop = CancellationToken::new();
    stop.cancel();
    assert!(container_health::verify(host, 1024, stop).await.is_err());
    Ok(())
}
