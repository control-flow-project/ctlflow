use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{
    future::Future,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

pub trait Clock: Send + Sync {
    fn now(&self) -> u64;
    fn wait(
        &self,
        milliseconds: u64,
        cancellation: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
}

pub struct NativeClock(Instant);

impl Default for NativeClock {
    fn default() -> Self {
        Self(Instant::now())
    }
}

impl Clock for NativeClock {
    fn now(&self) -> u64 {
        self.0.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
    }
    async fn wait(&self, milliseconds: u64, cancellation: CancellationToken) -> Result<()> {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err(cancelled()),
            _ = tokio::time::sleep(Duration::from_millis(milliseconds)) => Ok(()),
        }
    }
}

pub fn cancelled() -> Failure {
    Failure::new(
        ErrorCode::Unavailable,
        "Native input operation cancelled; read positions remain unchanged",
    )
}
pub fn check(cancellation: &CancellationToken) -> Result<()> {
    if cancellation.is_cancelled() {
        Err(cancelled())
    } else {
        Ok(())
    }
}

pub struct Scope {
    pub cancellation: CancellationToken,
    task: tokio::task::JoinHandle<()>,
}

impl Scope {
    pub fn new(lifetime: &CancellationToken, caller: CancellationToken) -> Self {
        let cancellation = lifetime.child_token();
        if caller.is_cancelled() {
            cancellation.cancel();
        }
        let target = cancellation.clone();
        let task = tokio::spawn(async move {
            tokio::select! { biased; _ = target.cancelled() => {}, _ = caller.cancelled() => target.cancel() }
        });
        Self { cancellation, task }
    }
}

impl Drop for Scope {
    fn drop(&mut self) {
        self.task.abort();
    }
}
