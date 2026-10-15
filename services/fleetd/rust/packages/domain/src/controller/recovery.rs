use super::*;
struct RecoveryTarget<'a> {
    fleet: &'a str,
    configuration: &'a Configuration,
    instance: &'a Instance,
}

fn recoverable(error: &Failure) -> bool {
    matches!(
        error.code,
        ErrorCode::Native | ErrorCode::Unavailable | ErrorCode::BodyTooLarge
    )
}
impl<R: Registry + 'static, E: Execution + 'static, T: Clock + Clone + Send + Sync + 'static>
    Controller<R, E, T>
{
    pub(super) fn launched(
        self: &Arc<Self>,
        fleet: &str,
        configuration: &Configuration,
        instance: &Instance,
        runtime: Arc<dyn RunningAgent>,
        stop: &CancellationToken,
        recovery: Option<&str>,
    ) -> Result<bool> {
        let key = (fleet.to_owned(), instance.key.clone());
        {
            let mut state = self.lock()?;
            if state.stopping
                || stop.is_cancelled()
                || !state.wanted.contains(&key)
                || state.running.contains_key(&key)
                || recovery
                    .is_some_and(|id| state.recovering.get(&key).is_none_or(|work| work.id != id))
            {
                return Ok(false);
            }
            if recovery.is_some() {
                state.recovering.remove(&key);
            }
            state.running.insert(key.clone(), runtime.clone());
            self.set_instance(&mut state, fleet, instance, InstancePhase::Running, None);
            if let Some(value) = state.instances.get_mut(&key) {
                value.session_id = Some(runtime.session_id().to_owned());
                value.started_at = Some(self.clock.now()?);
            }
        }
        let weak = Arc::downgrade(self);
        let configuration = configuration.clone();
        let instance = instance.clone();
        let fleet = fleet.to_owned();
        let controller_stop = self.lifetime.clone();
        tokio::spawn(async move {
            let native_stop = runtime.lifetime();
            tokio::select! { biased; _ = controller_stop.cancelled() => {}, _ = native_stop.cancelled() => {
                if let Some(controller) = weak.upgrade() {
                    let eligible = controller.lock().map(|state| !state.stopping && state.wanted.contains(&key) && state.running.get(&key).is_some_and(|current| Arc::ptr_eq(current, &runtime)) && state.instances.get(&key).is_some_and(|value| value.phase == InstancePhase::Running)).unwrap_or(false);
                    if eligible && let Err(error) = controller.recover(&fleet, &configuration, &instance, failed("Listener binding disconnected; recovering its exact saved identity and history"), Some(runtime), false).await
                        && let Ok(mut state) = controller.lock() { controller.set_instance(&mut state, &fleet, &instance, InstancePhase::Failed, Some(error.message)); }
                }
            } }
        });
        Ok(true)
    }
    pub(super) async fn recover(
        self: &Arc<Self>,
        fleet: &str,
        configuration: &Configuration,
        instance: &Instance,
        cause: Failure,
        previous: Option<Arc<dyn RunningAgent>>,
        immediate: bool,
    ) -> Result<()> {
        let key = (fleet.to_owned(), instance.key.clone());
        let (done, completion) = watch::channel(false);
        let work = Work {
            id: crossfire_kernel::identity::id(),
            stop: self.lifetime.child_token(),
            done: completion,
        };
        {
            let mut state = self.lock()?;
            if state.stopping || state.recovering.contains_key(&key) {
                return Ok(());
            }
            if let Some(previous) = &previous
                && (!state.wanted.contains(&key)
                    || state
                        .running
                        .get(&key)
                        .is_none_or(|current| !Arc::ptr_eq(current, previous))
                    || state
                        .instances
                        .get(&key)
                        .is_none_or(|value| value.phase != InstancePhase::Running))
            {
                return Ok(());
            }
            self.set_instance(
                &mut state,
                fleet,
                instance,
                if previous
                    .as_ref()
                    .is_some_and(|runtime| runtime.deliberately_stopped())
                {
                    InstancePhase::Stopping
                } else if immediate {
                    InstancePhase::Starting
                } else {
                    InstancePhase::Failed
                },
                (!immediate).then(|| cause.message.clone()),
            );
            state.recovering.insert(key.clone(), work.clone());
        }
        let (attempted, first) = watch::channel(false);
        let controller = self.clone();
        let fleet = fleet.to_owned();
        let configuration = configuration.clone();
        let instance = instance.clone();
        tokio::spawn(async move {
            let result = controller
                .recover_instance(
                    RecoveryTarget {
                        fleet: &fleet,
                        configuration: &configuration,
                        instance: &instance,
                    },
                    &work,
                    &attempted,
                    previous,
                    cause,
                    immediate,
                )
                .await;
            if let Ok(mut state) = controller.lock() {
                if let Err(error) = result {
                    controller.set_instance(
                        &mut state,
                        &fleet,
                        &instance,
                        InstancePhase::Failed,
                        Some(error.message),
                    );
                }
                if state
                    .recovering
                    .get(&key)
                    .is_some_and(|current| current.id == work.id)
                {
                    state.recovering.remove(&key);
                }
            }
            attempted.send_replace(true);
            done.send_replace(true);
            controller.signal();
        });
        let first = Work {
            id: String::new(),
            stop: CancellationToken::new(),
            done: first,
        };
        first.wait().await
    }
    async fn recover_instance(
        self: &Arc<Self>,
        target: RecoveryTarget<'_>,
        work: &Work,
        attempted: &watch::Sender<bool>,
        previous: Option<Arc<dyn RunningAgent>>,
        cause: Failure,
        immediate: bool,
    ) -> Result<()> {
        let RecoveryTarget {
            fleet,
            configuration,
            instance,
        } = target;
        let key = (fleet.to_owned(), instance.key.clone());
        if let Some(previous) = previous {
            if previous.deliberately_stopped() {
                self.intent(
                    &mut *self.lock()?,
                    fleet,
                    std::slice::from_ref(&instance.key),
                    false,
                )?;
                previous.close().await?;
                let mut state = self.lock()?;
                state.running.remove(&key);
                self.set_instance(&mut state, fleet, instance, InstancePhase::Stopped, None);
                return Ok(());
            }
            previous.close().await.map_err(|error| {
                conflict(&format!(
                    "Native recovery cleanup failed; replacement is blocked: {}",
                    error.message
                ))
            })?;
            self.lock()?.running.remove(&key);
        }
        if !recoverable(&cause) {
            return Ok(());
        }
        let mut attempt = 0_u32;
        loop {
            if (!immediate || attempt > 0)
                && !self
                    .delay(
                        Duration::from_millis((1000_u64 << attempt.min(6)).min(60000)),
                        &work.stop,
                    )
                    .await
            {
                return Ok(());
            }
            attempt = attempt.saturating_add(1);
            {
                let state = self.lock()?;
                if state.stopping || work.stop.is_cancelled() || !state.wanted.contains(&key) {
                    return Ok(());
                }
                if state.operations.contains_key(fleet) || state.mutations.contains(fleet) {
                    continue;
                }
            }
            let lease = tokio::select! { biased; _ = work.stop.cancelled() => return Ok(()), result = self.recovery_starts.acquire() => result.map_err(|_| failed("Native recovery admission is closed"))? };
            let result = self
                .execution
                .start(configuration, instance, true, work.stop.clone())
                .await;
            drop(lease);
            match result {
                Ok(runtime) => {
                    if !self.launched(
                        fleet,
                        configuration,
                        instance,
                        runtime.clone(),
                        &work.stop,
                        Some(&work.id),
                    )? {
                        runtime.close().await?;
                    }
                    return Ok(());
                }
                Err(error) => {
                    if work.stop.is_cancelled() {
                        return Ok(());
                    }
                    self.set_instance(
                        &mut *self.lock()?,
                        fleet,
                        instance,
                        InstancePhase::Failed,
                        Some(error.message.clone()),
                    );
                    attempted.send_replace(true);
                    if !recoverable(&error) {
                        return Ok(());
                    }
                }
            }
        }
    }
    pub(super) async fn stop_instance(&self, fleet: &str, instance: &Instance) -> Result<()> {
        let key = (fleet.to_owned(), instance.key.clone());
        let recovery = {
            let mut state = self.lock()?;
            let recovery = state.recovering.get(&key).cloned();
            if recovery.is_some() || state.running.contains_key(&key) {
                self.set_instance(&mut state, fleet, instance, InstancePhase::Stopping, None);
            }
            recovery
        };
        if let Some(recovery) = recovery {
            recovery.stop.cancel();
            recovery.wait().await?;
        }
        let runtime = self.lock()?.running.get(&key).cloned();
        if let Some(runtime) = runtime {
            runtime.close().await?;
            let mut state = self.lock()?;
            if state
                .running
                .get(&key)
                .is_some_and(|current| Arc::ptr_eq(current, &runtime))
            {
                state.running.remove(&key);
            }
        }
        self.set_instance(
            &mut *self.lock()?,
            fleet,
            instance,
            InstancePhase::Stopped,
            None,
        );
        Ok(())
    }
    pub(super) async fn restore(self: &Arc<Self>) -> Result<()> {
        let tasks = {
            let mut state = self.lock()?;
            let mut tasks = Vec::new();
            for record in state.records.clone() {
                let enabled = Self::enabled(&state, &record.fleet_id, None);
                if enabled.is_empty() {
                    continue;
                }
                let configuration = match self.registry.load(&record.directory) {
                    Ok(configuration) => configuration,
                    Err(error) => {
                        state
                            .connection_errors
                            .insert(record.directory, error.message);
                        continue;
                    }
                };
                let instances = configuration
                    .roster
                    .instances
                    .iter()
                    .filter(|instance| enabled.contains(&instance.key))
                    .cloned()
                    .collect::<Vec<_>>();
                let valid = self.execution.validate(&configuration);
                let error = if instances.len() != enabled.len() {
                    Some("Desired binding is missing from the saved roster; stop this fleet and review its files".to_owned())
                } else if configuration.roster.fleet != record.fleet_key
                    || configuration.digest != record.digest
                {
                    Some("Fleet files changed after their last accepted revision; review them and run an explicit update".to_owned())
                } else {
                    valid.err().map(|error| error.message)
                };
                if let Some(error) = error {
                    state
                        .connection_errors
                        .insert(record.directory, error.clone());
                    for instance in instances {
                        self.set_instance(
                            &mut state,
                            &record.fleet_id,
                            &instance,
                            InstancePhase::Failed,
                            Some(error.clone()),
                        );
                    }
                    continue;
                }
                state
                    .deployed
                    .insert(record.fleet_id.clone(), configuration.clone());
                for instance in instances {
                    self.set_instance(
                        &mut state,
                        &record.fleet_id,
                        &instance,
                        InstancePhase::Starting,
                        None,
                    );
                    tasks.push((record.fleet_id.clone(), configuration.clone(), instance));
                }
            }
            tasks
        };
        let mut restoration = tokio::task::JoinSet::new();
        for (fleet, configuration, instance) in tasks {
            let controller = self.clone();
            restoration.spawn(async move {
                controller
                    .recover(
                        &fleet,
                        &configuration,
                        &instance,
                        failed("Restoring the saved native identity and history"),
                        None,
                        true,
                    )
                    .await
            });
        }
        while let Some(result) = restoration.join_next().await {
            result.map_err(|_| failed("Native restoration task failed"))??;
        }
        Ok(())
    }
    pub async fn close(&self) -> Result<()> {
        let mut close = self.close_owner.lock().await;
        if let Some(result) = close.as_ref() {
            return result.clone();
        }
        let work = {
            let mut state = self.lock()?;
            state.stopping = true;
            state
                .operations
                .values()
                .chain(state.recovering.values())
                .cloned()
                .collect::<Vec<_>>()
        };
        for work in &work {
            work.stop.cancel();
        }
        self.lifetime.cancel();
        let mut error = self.ready().await.err();
        for work in work {
            if let Err(failure) = work.wait().await {
                error.get_or_insert(failure);
            }
        }
        let mut changed = self.changed.subscribe();
        loop {
            changed.borrow_and_update();
            if self.lock()?.mutations.is_empty() {
                break;
            }
            if changed.changed().await.is_err() {
                error.get_or_insert(failed("Roster mutation cleanup was not completed"));
                break;
            }
        }
        let running = self
            .lock()?
            .running
            .iter()
            .map(|(key, runtime)| (key.clone(), runtime.clone()))
            .collect::<Vec<_>>();
        for (key, runtime) in running {
            match runtime.close().await {
                Ok(()) => {
                    self.lock()?.running.remove(&key);
                }
                Err(failure) => {
                    error.get_or_insert(failure);
                }
            }
        }
        let result = error.map_or(Ok(()), Err);
        *close = Some(result.clone());
        result
    }
}
