use super::{MAX_FRAME_BYTES, error};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use std::{path::Path, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::{TcpStream, UnixStream},
};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, client_async_tls_with_config,
    tungstenite::{
        client::IntoClientRequest,
        http::{HeaderValue, header::AUTHORIZATION},
        protocol::WebSocketConfig,
    },
};
use tokio_util::sync::CancellationToken;

pub(super) trait Io: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> Io for T {}
pub(super) type Socket = WebSocketStream<MaybeTlsStream<Box<dyn Io>>>;

enum Endpoint {
    Unix(std::path::PathBuf),
    Loopback(url::Url),
}

fn endpoint(value: &str) -> Result<Endpoint> {
    let invalid = || {
        Failure::new(
            ErrorCode::Invalid,
            "Codex requires an explicit loopback WebSocket or private Unix socket",
        )
    };
    if let Some(path) = value.strip_prefix("unix://") {
        if path.contains('\0') || !Path::new(path).is_absolute() {
            return Err(invalid());
        }
        let path = Path::new(path);
        let parent = path.parent().ok_or_else(invalid)?;
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(invalid)?;
        PrivateDirectory::open(parent, false)?.socket(name)?;
        return Ok(Endpoint::Unix(path.to_owned()));
    }
    let url = url::Url::parse(value).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "ws" | "wss")
        || !matches!(url.host_str(), Some("127.0.0.1" | "[::1]" | "localhost"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err(invalid());
    }
    Ok(Endpoint::Loopback(url))
}

pub(super) fn validate(value: &str) -> Result<()> {
    endpoint(value).map(|_| ())
}

pub(super) async fn connect(
    value: &str,
    token: &Secret,
    timeout: Duration,
    cancellation: &CancellationToken,
) -> Result<Socket> {
    if token.expose().len() > 4096
        || token.expose().chars().any(|value| {
            value <= '\u{1f}' || value == '\u{7f}' || crossfire_kernel::text::whitespace(value)
        })
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid native Codex bearer token",
        ));
    }
    let endpoint = endpoint(value)?;
    let connect = async {
        let (mut request, stream): (_, Box<dyn Io>) = match endpoint {
            Endpoint::Unix(path) => (
                "ws://localhost/rpc"
                    .into_client_request()
                    .map_err(|_| error("Invalid Codex handshake"))?,
                Box::new(
                    UnixStream::connect(path)
                        .await
                        .map_err(|_| error("Codex Unix socket connection failed"))?,
                ),
            ),
            Endpoint::Loopback(url) => {
                if token.expose().is_empty() {
                    return Err(Failure::new(
                        ErrorCode::Invalid,
                        "Supply a private Codex bearer token",
                    ));
                }
                let host = url
                    .host_str()
                    .ok_or_else(|| error("Invalid Codex endpoint"))?;
                let port = url
                    .port_or_known_default()
                    .ok_or_else(|| error("Invalid Codex endpoint"))?;
                let mut request = url
                    .as_str()
                    .into_client_request()
                    .map_err(|_| error("Invalid Codex handshake"))?;
                let mut bearer = HeaderValue::from_str(&format!("Bearer {}", token.expose()))
                    .map_err(|_| error("Invalid Codex bearer token"))?;
                bearer.set_sensitive(true);
                request.headers_mut().insert(AUTHORIZATION, bearer);
                let stream = TcpStream::connect((host.trim_matches(['[', ']']), port))
                    .await
                    .map_err(|_| error("Codex loopback connection failed"))?;
                if !stream
                    .peer_addr()
                    .map_err(|_| error("Codex loopback peer is unavailable"))?
                    .ip()
                    .is_loopback()
                {
                    return Err(error("Codex peer must remain on loopback"));
                }
                (request, Box::new(stream))
            }
        };
        request.headers_mut().remove("sec-websocket-extensions");
        let configuration = WebSocketConfig::default()
            .max_message_size(Some(MAX_FRAME_BYTES))
            .max_frame_size(Some(MAX_FRAME_BYTES))
            .max_write_buffer_size(MAX_FRAME_BYTES)
            .write_buffer_size(0);
        let (socket, _) = client_async_tls_with_config(request, stream, Some(configuration), None)
            .await
            .map_err(|_| error("Codex authenticated WebSocket connection failed"))?;
        Ok(socket)
    };
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => Err(error("Codex connection cancelled")),
        result = tokio::time::timeout(timeout, connect) => result.map_err(|_| error("Codex handshake timed out"))?,
    }
}
