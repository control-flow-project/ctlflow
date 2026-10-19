use super::*;
use crossfire_domain::messaging_client::MessagingClient;

impl<
    S: LocalState,
    C: Coordination,
    M: MessagingClient + crossfire_domain::messaging_client::InvitationReader,
    N: Connection + TurnControl + Lifecycle + 'static,
    A: Acknowledgment,
    T: Clock + Clone + Send + Sync + 'static,
> Receiver<S, C, M, N, A, T>
{
    pub(super) async fn report(&self) -> Result<()> {
        loop {
            if self.hooks.stop.is_cancelled() {
                return self.hooks.check();
            }
            let reporting = async {
                if self.resources.control.current()?.connected {
                    self.hooks
                        .reporter
                        .activate(self.hooks.stop.clone())
                        .await?;
                    if let Some(release) = self
                        .hooks
                        .reporter
                        .heartbeat(self.hooks.stop.clone())
                        .await?
                    {
                        self.updates.available(&release)?;
                        self.changed()?;
                    }
                    self.hooks.broker.flush(self.hooks.stop.clone()).await?;
                    self.hooks.observer.flush(self.hooks.stop.clone()).await?;
                } else {
                    self.hooks.reporter.pause(self.hooks.stop.clone()).await?;
                }
                Ok(())
            };
            let result: Result<()> = tokio::select! { biased; _ = self.hooks.stop.cancelled() => return self.hooks.check(), result = tokio::time::timeout(Duration::from_secs(15), reporting) => result.map_err(|_| Failure::new(ErrorCode::Unavailable, "Listener reporting timed out; private journals remain retained"))? };
            if let Err(error) = result
                && !matches!(
                    error.code,
                    ErrorCode::Native | ErrorCode::Unavailable | ErrorCode::BodyTooLarge
                )
            {
                return Err(error);
            }
            self.wait(1000).await?;
        }
    }
}
