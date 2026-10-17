use crossfire_kernel::Result;
use serde_json::{Map, Value};
use std::future::Future;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum RequestId {
    Number(i64),
    Text(String),
}

pub struct Event {
    pub method: String,
    pub params: Map<String, Value>,
}
pub struct Request {
    pub id: RequestId,
    pub method: String,
    pub params: Map<String, Value>,
}

pub struct NativeError {
    pub code: i64,
    pub message: String,
}
impl NativeError {
    pub fn unmaterialized(&self, session: &str) -> bool {
        self.code == -32600
            && self.message
                == format!(
                    "thread {session} is not materialized yet; thread/turns/list is unavailable before first user message"
                )
    }
}
pub enum Reply {
    Value(Value),
    Error(NativeError),
}

pub trait Protocol: Send + Sync {
    fn lifetime(&self) -> CancellationToken;
    fn request(
        &self,
        method: &str,
        params: &Value,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<Reply>> + Send;
    fn notify(
        &self,
        method: &str,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn close(&self) -> impl Future<Output = Result<()>> + Send;
}

pub trait Callbacks: Send + Sync {
    fn event(&self, event: Event);
    fn decision(
        &self,
        request: &Request,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<Value>> + Send;
    fn responded(&self, request: &Request);
}
