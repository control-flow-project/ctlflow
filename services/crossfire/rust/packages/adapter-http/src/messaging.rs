use crate::server::{Body, Incoming, Peer, Request, Response};
use crossfire_kernel::Result;
use std::{future::Future, pin::Pin};

pub type BackendResponse<'a> = Pin<Box<dyn Future<Output = Result<Response<Body>>> + Send + 'a>>;
pub trait MessagingHttp: Send + Sync {
    fn handle(
        &self,
        input: Request<Incoming>,
        peer: Peer,
        request_id: String,
    ) -> BackendResponse<'_>;
}
