use super::*;
use crate::resume_selection::Selections;

impl<R: Registry + 'static, E: Execution + 'static, T: Clock + Clone + Send + Sync + 'static>
    Controller<R, E, T>
{
    pub async fn operate(
        self: &Arc<Self>,
        request: OperationRequest,
        receipt_pending: bool,
    ) -> Result<Operation> {
        if (request.action == Action::Update) != request.release_directory.is_some()
            || request
                .release_directory
                .as_ref()
                .is_some_and(|path| !path.is_absolute())
            || request.expected_revision < 0
        {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Invalid lifecycle operation identity, revision or explicit software directory",
            ));
        }
        if let Some(previous) = self.registry.operation(&request.id)? {
            return if previous.request == request {
                Ok(previous)
            } else {
                Err(conflict("Operation ID was used for a different request"))
            };
        }
        if request.target == Target::Daemon {
            if request.action != Action::Stop || request.expected_revision != 0 {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Daemon supports only an exact stop request",
                ));
            }
            let mut operation = Operation {
                request,
                status: OperationStatus::Running,
                created_at: self.clock.now()?,
                completed_at: None,
                approval: None,
                errors: vec![],
                receipt_pending: false,
            };
            self.registry.save_operation(&operation)?;
            let result = self.close().await;
            operation.status = if result.is_ok() {
                OperationStatus::Succeeded
            } else {
                OperationStatus::Failed
            };
            if let Err(error) = result {
                operation.errors.push(Self::error(None, &error));
            }
            operation.completed_at = Some(self.clock.now()?);
            self.registry.save_operation(&operation)?;
            return Ok(operation);
        }
        let fleet = request
            .target
            .fleet()
            .ok_or_else(|| Failure::new(ErrorCode::Invalid, "Missing fleet operation target"))?
            .to_owned();
        let (accepted, configuration, selected, predecessor, work, done) = {
            let mut state = self.lock()?;
            if let Some(previous) = self.registry.operation(&request.id)? {
                return if previous.request == request {
                    Ok(previous)
                } else {
                    Err(conflict("Operation ID was used for a different request"))
                };
            }
            if state.stopping {
                return Err(failed("Controller is stopping"));
            }
            if state.mutations.contains(&fleet) {
                return Err(conflict("A roster change is in progress"));
            }
            let record = state
                .records
                .iter()
                .find(|record| record.fleet_id == fleet)
                .ok_or_else(|| missing("Fleet is not registered"))?
                .clone();
            if record.revision != request.expected_revision {
                return Err(Failure::new(
                    ErrorCode::StaleRevision,
                    "Refresh the fleet before starting this operation",
                ));
            }
            if request.action == Action::Enroll
                && (request.target.instance().is_some() || Self::executing(&state, &fleet))
            {
                return Err(conflict(
                    "Enrollment without startup requires a stopped whole fleet",
                ));
            }
            let configuration = if request.action == Action::Stop {
                state
                    .deployed
                    .get(&fleet)
                    .cloned()
                    .or_else(|| self.registry.load(&record.directory).ok())
            } else {
                Some(self.inspect(&state, &fleet)?.1)
            };
            let mut catalog = configuration
                .as_ref()
                .map(|configuration| {
                    configuration
                        .roster
                        .instances
                        .iter()
                        .map(|instance| (instance.key.clone(), instance.clone()))
                        .collect::<BTreeMap<_, _>>()
                })
                .unwrap_or_default();
            if request.action == Action::Stop {
                for ((selected, key), value) in &state.instances {
                    if selected == &fleet {
                        catalog.insert(key.clone(), value.instance.clone());
                    }
                }
            }
            let enabled = Self::enabled(&state, &fleet, None);
            let selected = if request.target.instance().is_none() && request.action == Action::Start
            {
                Selections::load(self.registry.as_ref(), &state.records)?.select(
                    &fleet,
                    &catalog.values().cloned().collect::<Vec<_>>(),
                    &enabled,
                )?
            } else {
                catalog
                    .values()
                    .filter(|instance| {
                        request
                            .target
                            .instance()
                            .is_none_or(|key| key == instance.key)
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            };
            if let Some(instance) = request.target.instance()
                && selected.is_empty()
                && !state.wanted.contains(&(fleet.clone(), instance.to_owned()))
            {
                return Err(missing("Instance not found"));
            }
            if request.action == Action::Start && catalog.is_empty() {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Add an instance before starting this fleet",
                ));
            }
            if request.action != Action::Stop
                && selected.iter().any(|instance| {
                    state
                        .running
                        .get(&(fleet.clone(), instance.key.clone()))
                        .is_some_and(|runtime| {
                            runtime.lifetime().is_cancelled()
                                || state
                                    .instances
                                    .get(&(fleet.clone(), instance.key.clone()))
                                    .is_some_and(|value| value.phase == InstancePhase::Failed)
                        })
                })
            {
                return Err(conflict(
                    "Runtime failure cleanup is still in progress; retry after it finishes",
                ));
            }
            let predecessor = state.operations.get(&fleet).cloned();
            if predecessor.is_some() && request.action != Action::Stop {
                return Err(conflict("Another operation is active for this fleet"));
            }
            let accepted = Operation {
                request: request.clone(),
                status: OperationStatus::Accepted,
                created_at: self.clock.now()?,
                completed_at: None,
                approval: None,
                errors: vec![],
                receipt_pending,
            };
            self.registry.save_operation(&accepted)?;
            let checkpoint = (|| {
                if matches!(request.action, Action::Stop | Action::Reset) {
                    if request.action == Action::Stop {
                        self.save_selection(
                            &mut state,
                            &fleet,
                            &enabled,
                            request.target.instance(),
                        )?;
                    }
                    let keys = selected
                        .iter()
                        .map(|instance| instance.key.clone())
                        .chain(
                            enabled
                                .iter()
                                .filter(|key| {
                                    request
                                        .target
                                        .instance()
                                        .is_none_or(|instance| instance == key.as_str())
                                })
                                .cloned(),
                        )
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .collect::<Vec<_>>();
                    self.intent(&mut state, &fleet, &keys, false)?;
                }
                if request.action != Action::Stop
                    && let Some(configuration) = &configuration
                    && configuration.digest != record.digest
                {
                    self.execution.validate(configuration)?;
                    let revision = record
                        .revision
                        .checked_add(1)
                        .ok_or_else(|| conflict("Fleet revision overflow"))?;
                    let records = state
                        .records
                        .iter()
                        .cloned()
                        .map(|mut record| {
                            if record.fleet_id == fleet {
                                record.digest = configuration.digest.clone();
                                record.revision = revision;
                            }
                            record
                        })
                        .collect();
                    self.persist(&mut state, records)?;
                }
                Ok(())
            })();
            if let Err(error) = checkpoint {
                let mut rejected = accepted;
                rejected.status = OperationStatus::Failed;
                rejected.completed_at = Some(self.clock.now()?);
                rejected.errors.push(Self::error(None, &error));
                self.registry.save_operation(&rejected)?;
                return Err(error);
            }
            let (done, completion) = watch::channel(false);
            let work = Work {
                id: request.id.clone(),
                stop: self.lifetime.child_token(),
                done: completion,
            };
            state.operations.insert(fleet.clone(), work.clone());
            if let Some(configuration) = &configuration {
                state.deployed.insert(fleet.clone(), configuration.clone());
            }
            (accepted, configuration, selected, predecessor, work, done)
        };
        if let Some(previous) = &predecessor {
            previous.stop.cancel();
        }
        let controller = self.clone();
        let operation = accepted.clone();
        tokio::spawn(async move {
            let result = async {
                if let Some(previous) = predecessor {
                    previous.wait().await?;
                }
                controller
                    .execute_operation(
                        operation.clone(),
                        configuration,
                        selected.clone(),
                        work.stop.clone(),
                    )
                    .await
            }
            .await;
            let outcome = match result {
                Ok(completed) => completed,
                Err(error) => {
                    for instance in &selected {
                        if controller.stop_instance(&fleet, instance).await.is_err() {
                            controller.lifetime.cancel();
                        }
                    }
                    let mut failed_operation = operation;
                    failed_operation.status = OperationStatus::Failed;
                    failed_operation.completed_at = controller.clock.now().ok();
                    failed_operation.approval = None;
                    failed_operation.errors.push(Self::error(None, &error));
                    failed_operation
                }
            };
            if let Ok(mut state) = controller.lock() {
                if state
                    .operations
                    .get(&fleet)
                    .is_some_and(|current| current.id == work.id)
                {
                    state.operations.remove(&fleet);
                }
                if controller.registry.save_operation(&outcome).is_err() {
                    state.stopping = true;
                    controller.lifetime.cancel();
                }
            } else {
                controller.lifetime.cancel();
            }
            done.send_replace(true);
            controller.signal();
        });
        Ok(accepted)
    }
    fn error(instance: Option<&Instance>, error: &Failure) -> OperationError {
        OperationError {
            instance: instance.map(|instance| instance.key.clone()),
            code: error.code.as_str().to_owned(),
            message: error.message.clone(),
        }
    }
    pub(super) fn record_error(
        &self,
        fleet: &str,
        errors: &mut Vec<OperationError>,
        instance: Option<&Instance>,
        error: Failure,
    ) -> Result<()> {
        errors.push(Self::error(instance, &error));
        if let Some(instance) = instance {
            self.set_instance(
                &mut *self.lock()?,
                fleet,
                instance,
                InstancePhase::Failed,
                Some(error.message),
            );
        }
        Ok(())
    }
    pub(super) async fn stop_selected(
        &self,
        fleet: &str,
        instances: &[Instance],
        errors: &mut Vec<OperationError>,
    ) -> Result<()> {
        for instance in instances {
            if let Err(error) = self.stop_instance(fleet, instance).await {
                self.record_error(fleet, errors, Some(instance), error)?;
            }
        }
        Ok(())
    }
    async fn execute_operation(
        self: &Arc<Self>,
        mut operation: Operation,
        configuration: Option<Configuration>,
        selected: Vec<Instance>,
        stop: CancellationToken,
    ) -> Result<Operation> {
        operation.status = OperationStatus::Running;
        self.registry.save_operation(&operation)?;
        let fleet = operation
            .request
            .target
            .fleet()
            .ok_or_else(|| failed("Native operation lost its fleet identity"))?
            .to_owned();
        let mut errors = Vec::new();
        if let Err(error) = self
            .run_action(
                &mut operation,
                configuration.as_ref(),
                &selected,
                &stop,
                &mut errors,
            )
            .await
        {
            self.record_error(&fleet, &mut errors, None, error)?;
        }
        if stop.is_cancelled() && operation.request.action != Action::Stop {
            self.stop_selected(&fleet, &selected, &mut errors).await?;
        }
        {
            let mut state = self.lock()?;
            for instance in &selected {
                if state
                    .instances
                    .get(&(fleet.clone(), instance.key.clone()))
                    .is_some_and(|instance| {
                        matches!(
                            instance.phase,
                            InstancePhase::Starting | InstancePhase::AwaitingApproval
                        )
                    })
                {
                    self.set_instance(
                        &mut state,
                        &fleet,
                        instance,
                        InstancePhase::Failed,
                        Some(
                            errors
                                .first()
                                .map_or("Operation did not complete".to_owned(), |error| {
                                    error.message.clone()
                                }),
                        ),
                    );
                }
            }
        }
        if errors.is_empty()
            && operation.request.action == Action::Start
            && let Err(error) = self.registry.complete_setup(&operation.request.id)
        {
            self.record_error(&fleet, &mut errors, None, error)?;
        }
        operation.status = if errors.is_empty() {
            OperationStatus::Succeeded
        } else {
            OperationStatus::Failed
        };
        operation.completed_at = Some(self.clock.now()?);
        operation.approval = None;
        operation.errors = errors;
        Ok(operation)
    }
    pub(super) async fn execute_remote(
        self: &Arc<Self>,
        mut request: OperationRequest,
    ) -> Result<Operation> {
        let fleet = request
            .target
            .fleet()
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Remote native operations require their exact enrolled fleet",
                )
            })?
            .to_owned();
        request.expected_revision = match self.registry.operation(&request.id)? {
            Some(previous) => previous.request.expected_revision,
            None => self.view(&fleet)?.registration.revision,
        };
        let accepted = self.operate(request, true).await?;
        if accepted.completed_at.is_some() {
            return Ok(accepted);
        }
        let work = self.lock()?.operations.get(&fleet).cloned();
        if let Some(work) = work {
            work.wait().await?;
        }
        let completed = self.operation(&accepted.request.id)?;
        if completed.completed_at.is_none() {
            Err(failed("The native session operation did not complete"))
        } else {
            Ok(completed)
        }
    }
}
