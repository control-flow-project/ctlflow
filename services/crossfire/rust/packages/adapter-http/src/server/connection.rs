use super::{Body, Incoming, Request, Response};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use hyper::{server::conn::http1, service::service_fn};
use hyper_util::rt::{TokioIo, TokioTimer};
use std::{
    convert::Infallible,
    future::Future,
    net::SocketAddr,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite, ReadBuf},
    net::{TcpListener, TcpStream, UnixListener, UnixStream},
    sync::{Semaphore, watch},
    task::JoinSet,
    time::Instant,
};
use tokio_util::sync::CancellationToken;
#[derive(Debug, Clone, Copy)]
pub enum Peer {
    Tcp(SocketAddr),
    Unix(u32),
}
pub enum Listener {
    Tcp(TcpListener),
    Unix(UnixListener),
}
enum Stream {
    Tcp(TcpStream),
    Unix(UnixStream),
}
impl AsyncRead for Stream {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        buffer: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Tcp(stream) => Pin::new(stream).poll_read(context, buffer),
            Self::Unix(stream) => Pin::new(stream).poll_read(context, buffer),
        }
    }
}
impl AsyncWrite for Stream {
    fn poll_write(
        self: Pin<&mut Self>,
        context: &mut Context<'_>,
        bytes: &[u8],
    ) -> Poll<std::io::Result<usize>> {
        match self.get_mut() {
            Self::Tcp(stream) => Pin::new(stream).poll_write(context, bytes),
            Self::Unix(stream) => Pin::new(stream).poll_write(context, bytes),
        }
    }
    fn poll_flush(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Tcp(stream) => Pin::new(stream).poll_flush(context),
            Self::Unix(stream) => Pin::new(stream).poll_flush(context),
        }
    }
    fn poll_shutdown(self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<std::io::Result<()>> {
        match self.get_mut() {
            Self::Tcp(stream) => Pin::new(stream).poll_shutdown(context),
            Self::Unix(stream) => Pin::new(stream).poll_shutdown(context),
        }
    }
}
impl Listener {
    async fn accept(&self) -> Result<Option<(Stream, Peer)>> {
        match self {
            Self::Tcp(listener) => {
                let (stream, peer) = listener
                    .accept()
                    .await
                    .map_err(|_| Failure::new(ErrorCode::Unavailable, "HTTP listener failed"))?;
                stream.set_nodelay(true).map_err(|_| {
                    Failure::new(
                        ErrorCode::Unavailable,
                        "HTTP stream could not be configured",
                    )
                })?;
                Ok(Some((Stream::Tcp(stream), Peer::Tcp(peer))))
            }
            Self::Unix(listener) => {
                let (stream, _) = listener.accept().await.map_err(|_| {
                    Failure::new(ErrorCode::Unavailable, "Private HTTP listener failed")
                })?;
                let uid = stream
                    .peer_cred()
                    .map_err(|_| {
                        Failure::new(ErrorCode::Forbidden, "Private peer could not be verified")
                    })?
                    .uid();
                Ok((uid == rustix::process::getuid().as_raw())
                    .then_some((Stream::Unix(stream), Peer::Unix(uid))))
            }
        }
    }
}
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub connections: usize,
    pub idle: Duration,
    pub request: Duration,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            connections: 256,
            idle: Duration::from_secs(60),
            request: Duration::from_secs(30),
        }
    }
}
impl Limits {
    fn validate(self) -> Result<Self> {
        if self.connections == 0
            || self.connections > 4096
            || self.idle < Duration::from_secs(1)
            || self.idle > Duration::from_secs(300)
            || self.request < Duration::from_millis(100)
            || self.request > Duration::from_secs(60)
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid bounded HTTP server limits",
            ));
        }
        Ok(self)
    }
}
async fn idle(mut activity: watch::Receiver<Option<Instant>>) {
    loop {
        let deadline = *activity.borrow_and_update();
        if let Some(deadline) = deadline {
            tokio::select! { biased; changed = activity.changed() => if changed.is_err() { return; }, _ = tokio::time::sleep_until(deadline) => return, }
        } else if activity.changed().await.is_err() {
            return;
        }
    }
}
fn failure(error: Failure) -> Response<Body> {
    let request = crossfire_kernel::identity::id();
    let status = crossfire_contracts::envelope::http_status(error.code);
    let value = serde_json::json!({"error": error, "meta": {"requestId": request}}).to_string();
    let mut response = Response::new(super::full(value));
    *response.status_mut() =
        hyper::StatusCode::from_u16(status).unwrap_or(hyper::StatusCode::SERVICE_UNAVAILABLE);
    response.headers_mut().insert(
        hyper::header::CONTENT_TYPE,
        hyper::header::HeaderValue::from_static("application/json; charset=utf-8"),
    );
    response.headers_mut().insert(
        hyper::header::CACHE_CONTROL,
        hyper::header::HeaderValue::from_static("no-store"),
    );
    response.headers_mut().insert(
        hyper::header::CONTENT_SECURITY_POLICY,
        hyper::header::HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
    );
    response.headers_mut().insert(
        hyper::header::X_CONTENT_TYPE_OPTIONS,
        hyper::header::HeaderValue::from_static("nosniff"),
    );
    if let Ok(request) = hyper::header::HeaderValue::from_str(&request) {
        response.headers_mut().insert("x-request-id", request);
    }
    response
}
async fn connection<State, Handler, Task>(
    stream: Stream,
    peer: Peer,
    state: Arc<State>,
    handler: Handler,
    limits: Limits,
    stop: CancellationToken,
) where
    State: Send + Sync + 'static,
    Handler: Fn(Arc<State>, Request<Incoming>, Peer) -> Task + Clone + Send + Sync + 'static,
    Task: Future<Output = Result<Response<Body>>> + Send + 'static,
{
    let (activity, observed) = watch::channel(Some(Instant::now() + limits.idle));
    let service = service_fn(move |request| {
        let state = state.clone();
        let handler = handler.clone();
        let activity = activity.clone();
        async move {
            activity.send_replace(None);
            let outcome = tokio::time::timeout(limits.request, handler(state, request, peer)).await;
            activity.send_replace(Some(Instant::now() + limits.idle));
            Ok::<_, Infallible>(match outcome {
                Ok(Ok(response)) => response,
                Ok(Err(error)) => failure(error),
                Err(_) => failure(Failure::new(
                    ErrorCode::Unavailable,
                    "HTTP operation exceeded its finite deadline",
                )),
            })
        }
    });
    let mut builder = http1::Builder::new();
    builder
        .timer(TokioTimer::new())
        .header_read_timeout(Duration::from_secs(10))
        .max_buf_size(65536)
        .max_headers(100)
        .keep_alive(true);
    let connection = builder.serve_connection(TokioIo::new(stream), service);
    tokio::pin!(connection);
    tokio::select! { biased; _ = stop.cancelled() => connection.as_mut().graceful_shutdown(), _ = idle(observed) => connection.as_mut().graceful_shutdown(), _ = connection.as_mut() => return, }
    let _closed = tokio::time::timeout(Duration::from_secs(5), connection).await;
}
pub async fn serve<State, Handler, Task>(
    listener: Listener,
    state: Arc<State>,
    handler: Handler,
    limits: Limits,
    stop: CancellationToken,
) -> Result<()>
where
    State: Send + Sync + 'static,
    Handler: Fn(Arc<State>, Request<Incoming>, Peer) -> Task + Clone + Send + Sync + 'static,
    Task: Future<Output = Result<Response<Body>>> + Send + 'static,
{
    let limits = limits.validate()?;
    let capacity = Arc::new(Semaphore::new(limits.connections));
    let mut tasks = JoinSet::new();
    loop {
        tokio::select! { biased;
            _ = stop.cancelled() => break,
            Some(_finished) = tasks.join_next(), if !tasks.is_empty() => {},
            accepted = listener.accept() => {
                let Some((stream, peer)) = accepted? else { continue; };
                let Ok(permit) = capacity.clone().try_acquire_owned() else { continue; };
                let state = state.clone(); let handler = handler.clone(); let stop = stop.child_token();
                tasks.spawn(async move { let _permit = permit; connection(stream, peer, state, handler, limits, stop).await; });
            }
        }
    }
    stop.cancel();
    while tasks.join_next().await.is_some() {}
    Ok(())
}
