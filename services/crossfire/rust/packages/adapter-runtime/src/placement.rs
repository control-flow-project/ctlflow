use crossfire_adapter_process::execution::NativeExecution;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::{future::Future, path::PathBuf, pin::Pin, sync::Arc};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct LeaseRequest {
    pub directory: PathBuf,
    pub workspace: PathBuf,
    pub state_directory: PathBuf,
    pub home: PathBuf,
}

// The release operation includes execution teardown, not just a lock release.
#[derive(Clone)]
pub struct NativeLease {
    pub execution: NativeExecution,
    state: Arc<LeaseState>,
}
struct LeaseState {
    close: CancellationToken,
    closed: watch::Receiver<Option<Result<()>>>,
}
impl NativeLease {
    pub fn new<F, R>(execution: NativeExecution, release: F) -> Self
    where
        F: FnOnce() -> R + Send + 'static,
        R: Future<Output = Result<()>> + Send + 'static,
    {
        let close = CancellationToken::new();
        let requested = close.clone();
        let (complete, closed) = watch::channel(None);
        tokio::spawn(async move {
            requested.cancelled().await;
            complete.send_replace(Some(release().await));
        });
        Self {
            execution,
            state: Arc::new(LeaseState { close, closed }),
        }
    }
    pub async fn close(&self) -> Result<()> {
        self.state.close.cancel();
        let mut closed = self.state.closed.clone();
        loop {
            let result = closed.borrow().clone();
            if let Some(result) = result {
                return result;
            }
            closed.changed().await.map_err(|_| {
                Failure::new(
                    ErrorCode::Native,
                    "Native execution cleanup ended without confirmation",
                )
            })?;
        }
    }
}
impl Drop for LeaseState {
    fn drop(&mut self) {
        self.close.cancel();
    }
}

pub type PlacementFuture = Pin<Box<dyn Future<Output = Result<NativeLease>> + Send>>;
pub type OpenPlacement = dyn Fn(LeaseRequest, CancellationToken) -> PlacementFuture + Send + Sync;
#[derive(Clone)]
pub struct NativePlacement {
    pub open: Arc<OpenPlacement>,
}
impl Default for NativePlacement {
    fn default() -> Self {
        Self::local(NativeExecution::default())
    }
}
impl NativePlacement {
    pub fn local(execution: NativeExecution) -> Self {
        Self {
            open: Arc::new(move |request, cancellation| {
                let execution = execution.clone();
                Box::pin(async move {
                    crate::clock::check(&cancellation)?;
                    let ownership = crate::ownership::acquire(
                        &request.directory,
                        &request.workspace,
                        &request.home,
                    )?;
                    Ok(NativeLease::new(execution, move || async move {
                        drop(ownership);
                        Ok(())
                    }))
                })
            }),
        }
    }
}
