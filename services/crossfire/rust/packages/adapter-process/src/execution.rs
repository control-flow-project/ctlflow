use crate::{NativeCommand, Output, capture};
use crossfire_kernel::Result;
use std::{future::Future, pin::Pin, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

pub type CommandPlacement = dyn Fn(&NativeCommand) -> Result<NativeCommand> + Send + Sync;
pub type EndpointFuture = Pin<Box<dyn Future<Output = Result<String>> + Send>>;
pub type EndpointPlacement = dyn Fn(String, CancellationToken) -> EndpointFuture + Send + Sync;

// The selected owner places every native command and maps private endpoints.
// A placement failure is never retried as host execution.
#[derive(Clone)]
pub struct NativeExecution {
    pub command: Arc<CommandPlacement>,
    pub endpoint: Arc<EndpointPlacement>,
    pub ssh: Option<crate::ssh_commands::SshExecution>,
}

impl Default for NativeExecution {
    fn default() -> Self {
        Self {
            command: Arc::new(|command| Ok(command.clone())),
            endpoint: Arc::new(|endpoint, _| Box::pin(async move { Ok(endpoint) })),
            ssh: None,
        }
    }
}

impl NativeExecution {
    pub async fn capture(
        &self,
        command: &NativeCommand,
        maximum: usize,
        deadline: Duration,
        cancellation: CancellationToken,
    ) -> Result<Output> {
        capture(&(self.command)(command)?, maximum, deadline, cancellation).await
    }
}
