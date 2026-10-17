pub use tokio::sync::Mutex;
pub use tokio_util::sync::CancellationToken;

pub struct StartupScope {
    pub cancellation: CancellationToken,
    task: Option<tokio::task::JoinHandle<()>>,
    transferred: bool,
}
impl StartupScope {
    pub fn new(lifetime: &CancellationToken, caller: Option<&CancellationToken>) -> Self {
        let cancellation = lifetime.child_token();
        let task = caller.map(|caller| {
            if caller.is_cancelled() { cancellation.cancel(); }
            let caller = caller.clone();
            let target = cancellation.clone();
            tokio::spawn(async move {
                tokio::select! { biased; _=target.cancelled()=>{}, _=caller.cancelled()=>target.cancel() }
            })
        });
        Self {
            cancellation,
            task,
            transferred: false,
        }
    }
    pub async fn transfer(
        &mut self,
        caller: Option<&CancellationToken>,
    ) -> crossfire_kernel::Result<()> {
        if let Some(task) = self.task.take() {
            task.abort();
            if let Err(error) = task.await
                && !error.is_cancelled()
            {
                self.cancellation.cancel();
                return Err(crossfire_kernel::Failure::new(
                    crossfire_kernel::failure::ErrorCode::Unavailable,
                    "Native startup cancellation owner failed",
                ));
            }
        }
        if self.cancellation.is_cancelled() || caller.is_some_and(CancellationToken::is_cancelled) {
            self.cancellation.cancel();
            return Err(crossfire_kernel::Failure::new(
                crossfire_kernel::failure::ErrorCode::Unavailable,
                "Native startup was cancelled before admission",
            ));
        }
        self.transferred = true;
        Ok(())
    }
}
impl Drop for StartupScope {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
        if !self.transferred {
            self.cancellation.cancel();
        }
    }
}
