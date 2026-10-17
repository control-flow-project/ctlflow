use super::*;

impl<R: Registry + 'static, E: Execution + 'static, T: Clock + Clone + Send + Sync + 'static>
    Controller<R, E, T>
{
    pub(super) async fn run_action(
        self: &Arc<Self>,
        operation: &mut Operation,
        configuration: Option<&Configuration>,
        selected: &[Instance],
        stop: &CancellationToken,
        errors: &mut Vec<OperationError>,
    ) -> Result<()> {
        let fleet = operation
            .request
            .target
            .fleet()
            .ok_or_else(|| failed("Native operation lost its fleet identity"))?;
        let action = operation.request.action;
        if action == Action::Stop {
            self.stop_selected(fleet, selected, errors).await?;
            if let Some(configuration) = configuration {
                for instance in selected
                    .iter()
                    .filter(|instance| {
                        !errors
                            .iter()
                            .any(|error| error.instance.as_ref() == Some(&instance.key))
                    })
                    .cloned()
                    .collect::<Vec<_>>()
                {
                    if let Err(error) = self
                        .execution
                        .confirm_stopped(configuration, &instance, stop.clone())
                        .await
                    {
                        self.record_error(fleet, errors, Some(&instance), error)?;
                    }
                }
            }
            return Ok(());
        }
        let configuration = configuration.ok_or_else(|| {
            Failure::new(
                ErrorCode::Invalid,
                "Starting or updating requires a validated fleet configuration",
            )
        })?;
        if action == Action::Update {
            let enabled = {
                let state = self.lock()?;
                selected
                    .iter()
                    .filter(|instance| {
                        state
                            .wanted
                            .contains(&(fleet.to_owned(), instance.key.clone()))
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            };
            self.stop_selected(fleet, selected, errors).await?;
            let directory = operation
                .request
                .release_directory
                .as_ref()
                .ok_or_else(|| {
                    Failure::new(
                        ErrorCode::Invalid,
                        "Software update requires its reviewed release directory",
                    )
                })?;
            for instance in selected {
                Self::cancelled(stop)?;
                if errors
                    .iter()
                    .any(|error| error.instance.as_ref() == Some(&instance.key))
                {
                    continue;
                }
                if let Err(error) = self
                    .execution
                    .update(configuration, instance, directory, stop.clone())
                    .await
                {
                    self.record_error(fleet, errors, Some(instance), error)?;
                }
            }
            self.connect(configuration)?;
            for instance in enabled {
                if !self
                    .lock()?
                    .wanted
                    .contains(&(fleet.to_owned(), instance.key.clone()))
                    || errors
                        .iter()
                        .any(|error| error.instance.as_ref() == Some(&instance.key))
                {
                    continue;
                }
                self.start_selected(fleet, configuration, &instance, stop, errors)
                    .await?;
            }
            return Ok(());
        }
        if action == Action::Start && selected.is_empty() {
            return Ok(());
        }
        self.execution.validate(configuration)?;
        let recovering = {
            let state = self.lock()?;
            selected
                .iter()
                .filter(|instance| {
                    state
                        .recovering
                        .contains_key(&(fleet.to_owned(), instance.key.clone()))
                })
                .cloned()
                .collect::<Vec<_>>()
        };
        self.stop_selected(fleet, &recovering, errors).await?;
        if action == Action::Reset {
            self.execution
                .inspect(configuration, selected, stop.clone())
                .await?;
            let pending = selected
                .iter()
                .filter(|instance| {
                    !errors
                        .iter()
                        .any(|error| error.instance.as_ref() == Some(&instance.key))
                })
                .cloned()
                .collect::<Vec<_>>();
            self.stop_selected(fleet, &pending, errors).await?;
            for instance in pending {
                if errors
                    .iter()
                    .any(|error| error.instance.as_ref() == Some(&instance.key))
                {
                    continue;
                }
                if let Err(error) = self
                    .execution
                    .reset(
                        configuration,
                        &instance,
                        &operation.request.id,
                        stop.clone(),
                    )
                    .await
                {
                    self.record_error(fleet, errors, Some(&instance), error)?;
                }
            }
        }
        {
            let mut state = self.lock()?;
            for instance in selected {
                if !state
                    .running
                    .contains_key(&(fleet.to_owned(), instance.key.clone()))
                    && !errors
                        .iter()
                        .any(|error| error.instance.as_ref() == Some(&instance.key))
                {
                    self.set_instance(&mut state, fleet, instance, InstancePhase::Starting, None);
                }
            }
        }
        let weak = Arc::downgrade(self);
        let approval_operation = operation.clone();
        let fleet_id = fleet.to_owned();
        let selected_approval = selected.to_vec();
        let approval = Arc::new(move |link| {
            let controller = weak
                .upgrade()
                .ok_or_else(|| failed("Controller closed before enrollment approval"))?;
            let mut operation = approval_operation.clone();
            operation.status = OperationStatus::AwaitingApproval;
            operation.approval = Some(link);
            controller.registry.save_operation(&operation)?;
            let mut state = controller.lock()?;
            for instance in &selected_approval {
                if !state
                    .running
                    .contains_key(&(fleet_id.clone(), instance.key.clone()))
                    && state
                        .instances
                        .get(&(fleet_id.clone(), instance.key.clone()))
                        .is_none_or(|instance| instance.phase != InstancePhase::Failed)
                {
                    controller.set_instance(
                        &mut state,
                        &fleet_id,
                        instance,
                        InstancePhase::AwaitingApproval,
                        None,
                    );
                }
            }
            Ok(())
        });
        self.execution
            .prepare(
                configuration,
                &self.identity,
                action == Action::Enroll,
                approval,
                stop.clone(),
            )
            .await?;
        Self::cancelled(stop)?;
        self.connect(configuration)?;
        if let Some(error) = self
            .lock()?
            .connection_errors
            .get(&configuration.directory)
            .cloned()
        {
            return Err(failed(&error));
        }
        operation.status = OperationStatus::Running;
        operation.approval = None;
        self.registry.save_operation(operation)?;
        if action == Action::Enroll {
            let mut state = self.lock()?;
            for instance in selected {
                let error = errors
                    .iter()
                    .find(|error| error.instance.as_ref() == Some(&instance.key))
                    .map(|error| error.message.clone());
                self.set_instance(
                    &mut state,
                    fleet,
                    instance,
                    if error.is_some() {
                        InstancePhase::Failed
                    } else {
                        InstancePhase::Stopped
                    },
                    error,
                );
            }
            return Ok(());
        }
        let keys = selected
            .iter()
            .filter(|instance| {
                !errors
                    .iter()
                    .any(|error| error.instance.as_ref() == Some(&instance.key))
            })
            .map(|instance| instance.key.clone())
            .collect::<Vec<_>>();
        self.intent(&mut *self.lock()?, fleet, &keys, true)?;
        for instance in selected {
            Self::cancelled(stop)?;
            if errors
                .iter()
                .any(|error| error.instance.as_ref() == Some(&instance.key))
            {
                continue;
            }
            self.start_selected(fleet, configuration, instance, stop, errors)
                .await?;
        }
        Ok(())
    }
    fn cancelled(stop: &CancellationToken) -> Result<()> {
        if stop.is_cancelled() {
            Err(failed(
                "Native operation was cancelled by controller shutdown or explicit stop",
            ))
        } else {
            Ok(())
        }
    }
    async fn start_selected(
        self: &Arc<Self>,
        fleet: &str,
        configuration: &Configuration,
        instance: &Instance,
        stop: &CancellationToken,
        errors: &mut Vec<OperationError>,
    ) -> Result<()> {
        let runtime = self
            .lock()?
            .running
            .get(&(fleet.to_owned(), instance.key.clone()))
            .cloned();
        if let Some(runtime) = runtime {
            if let Err(error) = runtime.resume().await {
                self.record_error(fleet, errors, Some(instance), error)?;
            }
            return Ok(());
        }
        match self
            .execution
            .start(configuration, instance, false, stop.clone())
            .await
        {
            Ok(runtime) => {
                if !self.launched(fleet, configuration, instance, runtime.clone(), stop, None)? {
                    runtime.close().await?;
                }
            }
            Err(error) => {
                let retry = recovery::recoverable(&error) && !stop.is_cancelled();
                let cause = error.clone();
                self.record_error(fleet, errors, Some(instance), error)?;
                if retry {
                    self.recover(fleet, configuration, instance, cause, None, false)
                        .await?;
                }
            }
        }
        Ok(())
    }
}
