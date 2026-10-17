use super::*;

impl<R: Registry + 'static, E: Execution + 'static, T: Clock + Clone + Send + Sync + 'static>
    Controller<R, E, T>
{
    pub async fn setup(
        self: &Arc<Self>,
        input: &SetupRequest,
        stop: CancellationToken,
    ) -> Result<SetupOutcome> {
        let _setup = tokio::select! { _ = stop.cancelled() => return Err(failed("Setup cancelled")), lease = self.setup_owner.lock() => lease };
        if self.stopping()? {
            return Err(failed("Controller is stopping"));
        }
        let prepared = self.registry.setup(input)?;
        let configuration = prepared.configuration;
        self.execution
            .inspect(
                &configuration,
                &configuration.roster.instances,
                stop.clone(),
            )
            .await?;
        let record = self
            .lock()?
            .records
            .iter()
            .find(|record| record.directory == configuration.directory)
            .cloned();
        if prepared.completed && record.is_none() {
            return Err(conflict(
                "Completed setup was unregistered; an archived identity cannot be recreated implicitly",
            ));
        }
        if record.is_some() {
            self.ready().await?;
        }
        let current = match &record {
            None => self.add(&configuration.directory)?,
            Some(record) => self.view(&record.fleet_id)?,
        };
        if prepared.completed {
            return self.existing_setup(current, stop).await;
        }
        let operation = self.registry.operation(&prepared.operation_id)?;
        let stopped = record.is_some()
            && current.resume_instance_keys.is_some()
            && current
                .instances
                .iter()
                .all(|instance| !instance.desired_active);
        let restored = record.is_some()
            && operation
                .as_ref()
                .is_some_and(|operation| operation.status == OperationStatus::Failed)
            && !current.instances.is_empty()
            && current.instances.iter().all(|instance| {
                instance.desired_active
                    && instance.session_id.is_some()
                    && matches!(
                        instance.phase,
                        InstancePhase::Running | InstancePhase::Sleeping
                    )
            });
        if stopped || restored {
            let outcome = self.existing_setup(current, stop).await?;
            self.registry.complete_setup(&prepared.operation_id)?;
            return Ok(outcome);
        }
        let accepted = match operation {
            Some(operation) if operation.status != OperationStatus::Failed => operation,
            previous => {
                let id = if previous.is_some() {
                    let id = crossfire_kernel::identity::id();
                    self.registry.retry_setup(&prepared.operation_id, &id)?;
                    id
                } else {
                    prepared.operation_id
                };
                self.operate(
                    OperationRequest {
                        id,
                        target: Target::Fleet(current.registration.fleet_id.clone()),
                        action: Action::Start,
                        expected_revision: current.registration.revision,
                        release_directory: None,
                    },
                    false,
                )
                .await?
            }
        };
        let status = if accepted.status == OperationStatus::Succeeded {
            "ready"
        } else {
            "starting"
        }
        .to_owned();
        Ok(SetupOutcome {
            fleet: current,
            operation: Some(accepted),
            status,
        })
    }
    async fn existing_setup(
        &self,
        current: FleetState,
        stop: CancellationToken,
    ) -> Result<SetupOutcome> {
        let active = current
            .instances
            .iter()
            .any(|instance| instance.desired_active);
        let ready = current.connection.connected
            && current.instances.iter().all(|instance| {
                !instance.desired_active
                    || instance.session_id.is_some()
                        && matches!(
                            instance.phase,
                            InstancePhase::Running | InstancePhase::Sleeping
                        )
            });
        if active && ready {
            self.test(&current.registration.fleet_id, stop).await?;
        }
        Ok(SetupOutcome {
            fleet: current,
            operation: None,
            status: if active {
                if ready { "ready" } else { "starting" }
            } else {
                "stopped"
            }
            .to_owned(),
        })
    }
}
