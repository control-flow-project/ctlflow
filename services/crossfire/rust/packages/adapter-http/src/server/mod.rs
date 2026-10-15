mod body;
mod connection;
pub use body::{Body, empty, full, json, read};
pub use connection::{Limits, Listener, Peer, serve};
pub use hyper::body::Incoming;
pub use hyper::header;
pub use hyper::{HeaderMap, Method, Request, Response, StatusCode};

pub fn private_unix(path: &std::path::Path) -> crossfire_kernel::Result<tokio::net::UnixListener> {
    let socket = crossfire_adapter_filesystem::socket::Socket::prepare(path)?;
    let listener = tokio::net::UnixListener::bind(socket.endpoint()).map_err(|_| {
        crossfire_kernel::Failure::new(
            crossfire_kernel::failure::ErrorCode::Unavailable,
            "Cannot bind the selected private daemon socket",
        )
    })?;
    socket.protect()?;
    Ok(listener)
}
