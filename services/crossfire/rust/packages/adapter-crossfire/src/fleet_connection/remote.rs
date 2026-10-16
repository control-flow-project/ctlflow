use super::*;
use crossfire_domain::fleet::runtime::Status as RuntimeStatus;

impl<C: Coordination + 'static, E: Executor + 'static> Fleet<C, E> {
    pub(super) async fn start_remote(self: &Arc<Self>, command: Command) -> Result<()> {
        let mut task = self.runtime.lock().await;
        if task.as_ref().is_some_and(|task| !task.is_finished()) {
            return Ok(());
        }
        if let Some(previous) = task.take() {
            match previous.await {
                Ok(Ok(())) => {}
                Ok(Err(error)) => self.disconnect(&error.message)?,
                Err(_) => self.disconnect("Native control task failed")?,
            }
        }
        let fleet = self.clone();
        *task = Some(tokio::spawn(async move {
            let result = fleet.execute_remote(command).await;
            if let Err(error) = &result
                && !fleet.stop.is_cancelled()
            {
                fleet.disconnect(&error.message)?;
            }
            result
        }));
        Ok(())
    }
    async fn execute_remote(&self, command: Command) -> Result<()> {
        let binding = self.binding()?;
        let mut call = self.call(OperationId::ClaimFleetRuntime);
        call.parameters
            .insert("operationId".to_owned(), command.id.clone());
        call.body = Some(json!({"connectionId":binding.connection_id}));
        let claimed = self.coordination.call(&call, self.stop.clone()).await?;
        let claimed = fleet_snapshot::command(&claimed, &self.fleet)?;
        if claimed.id != command.id
            || claimed.agent != command.agent
            || claimed.action != command.action
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Native command changed during its authenticated claim",
            ));
        }
        if matches!(
            claimed.status,
            RuntimeStatus::Succeeded | RuntimeStatus::Failed
        ) {
            return self.executor.acknowledged(&command.id);
        }
        if claimed.status != RuntimeStatus::Running {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Controller claim did not authorize native execution",
            ));
        }
        let outcome = match self.executor.execute(claimed, self.stop.clone()).await {
            Ok(outcome) => outcome,
            Err(error) => Outcome {
                succeeded: false,
                error: Some(error.message),
            },
        };
        let error = outcome.error.map(|error| {
            let filtered = error
                .chars()
                .map(|character| {
                    if character <= '\u{1f}' || character == '\u{7f}' {
                        ' '
                    } else {
                        character
                    }
                })
                .collect::<String>();
            crossfire_kernel::text::truncate_utf16(&filtered, 4096).to_owned()
        });
        let mut call = self.call(OperationId::ReceiptFleetRuntime);
        call.parameters
            .insert("operationId".to_owned(), command.id.clone());
        call.body = Some(
            json!({"connectionId":binding.connection_id,"status":if outcome.succeeded {"succeeded"} else {"failed"},"errorMessage":error}),
        );
        self.coordination.call(&call, self.stop.clone()).await?;
        self.executor.acknowledged(&command.id)
    }
}
