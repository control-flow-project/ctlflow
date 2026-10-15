use super::*;
use crate::listener_budget::Work;
use crate::{
    chat_publication::Outcome,
    matrix::{self, API, Request},
    origins,
    source_control::{Control as SourceControl, Notices},
    steering,
};
use crossfire_contracts::{operations::Method, origin::segment};

impl<
    S: LocalState,
    C: Coordination,
    M: Matrix,
    N: Connection + TurnControl + Lifecycle + 'static,
    A: Acknowledgment,
    T: Clock + Clone + Send + Sync + 'static,
> Receiver<S, C, M, N, A, T>
{
    async fn send<F, V>(&self, priority: bool, operation: V) -> Result<bool>
    where
        F: Future<Output = Result<()>> + Send,
        V: FnOnce(CancellationToken) -> F,
    {
        let control = self.resources.control.current()?;
        if !control.active {
            return Ok(false);
        }
        if !priority && (self.controls.urgent()?.is_some() || self.queries.is_pending()?) {
            return Ok(false);
        }
        let ordinary = self
            .state
            .lock()
            .map_err(|_| invalid("Receiver ownership failed"))?
            .ordinary
            .clone();
        let scope = self.hooks.stop.child_token();
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Receiver ownership failed"))?;
            if state.sending.is_some() {
                return Err(invalid("A native receiver publication is already running"));
            }
            state.sending = Some(scope.clone());
        }
        let _sending = Sending {
            state: &self.state,
            changed: &self.changed,
        };
        let publication = async {
            let _budget = if priority {
                None
            } else {
                Some(
                    self.resources
                        .budget
                        .acquire(Work::Publication, scope.clone(), false)
                        .await?,
                )
            };
            let _lease = match self.gate.publication() {
                Ok(lease) => lease,
                Err(error) if error.code == ErrorCode::Conflict => return Ok(false),
                Err(error) => return Err(error),
            };
            operation(scope.clone()).await.map(|_| true)
        };
        let preempted = async {
            if priority {
                std::future::pending::<()>().await
            } else {
                ordinary.cancelled().await
            }
        };
        let result = tokio::select! { biased; _ = self.hooks.stop.cancelled() => self.hooks.check().map(|_| false), _ = control.generation.cancelled() => Ok(false), _ = preempted => Ok(false), _ = scope.cancelled() => Ok(false), result = publication => result };
        scope.cancel();
        result
    }
    async fn accepted(
        &self,
        outcome: &Outcome,
        priority: bool,
        stop: CancellationToken,
    ) -> Result<()> {
        self.hooks.reporter.record(&outcome.batch.events, true)?;
        for (room, session) in &outcome.deliveries {
            self.hooks
                .observer
                .delivered(room, session, stop.clone())
                .await?;
        }
        if priority {
            self.controls
                .accepted(&outcome.batch.events, &self.receipts)?;
        }
        Ok(())
    }
    async fn finish(
        &self,
        outcome: Outcome,
        priority: bool,
        stop: CancellationToken,
    ) -> Result<()> {
        self.accepted(&outcome, priority, stop.clone()).await?;
        if !priority {
            receive_state::acknowledge(
                self.resources.storage.as_ref(),
                self.resources.matrix.as_ref(),
                &self.options.file,
                &outcome.batch,
                stop,
            )
            .await?;
            self.controls.checkpoint(&outcome.batch.events)?;
        }
        self.native.acknowledge(&outcome.message_ids)?;
        if priority {
            self.priority.acknowledge()?;
        } else {
            self.chat.acknowledge()?;
            if outcome.batch.more_rooms.is_empty() {
                receive_snapshots::save_wake(
                    self.resources.storage.as_ref(),
                    &self.options.file,
                    None,
                )?;
                self.state
                    .lock()
                    .map_err(|_| invalid("Receiver ownership failed"))?
                    .wake = None;
            }
        }
        self.gate.pending(
            self.chat.pending()? || self.priority.pending()? || self.controls.pending()?,
        )?;
        Ok(())
    }
    async fn urgent(&self, urgent: SourceControl, stop: CancellationToken) -> Result<()> {
        let native = matrix::request(
            self.resources.matrix.as_ref(),
            &Request::new(
                Method::Get,
                format!(
                    "{API}/rooms/{}/event/{}",
                    segment(&urgent.room),
                    segment(&urgent.event)
                ),
            ),
            stop.clone(),
        )
        .await?;
        let event = crate::events::take(native, &urgent.room)?;
        if event.event_id != urgent.event {
            return Err(invalid("Original urgent event identity changed"));
        }
        self.refresh(stop.clone()).await?;
        let policy = self.policy()?;
        if !self.rooms()?.contains(&urgent.room)
            || !steering::authorized(
                self.resources.matrix.as_ref(),
                self.resources.coordination.as_ref(),
                &self.options.profile,
                &event,
                &policy.senders,
                stop.clone(),
            )
            .await?
        {
            self.receipts.stage(
                &event,
                "failed",
                Some("Source or room authority changed before native input"),
            )?;
            self.controls.supersede(&urgent)?;
            return Ok(());
        }
        if !self.priority.pending()? {
            let events = origins::enrich(
                self.resources.matrix.as_ref(),
                &self.options.profile.account.user_id,
                vec![event],
                stop.clone(),
            )
            .await?;
            let identities = crate::coordination::senders(
                self.resources.coordination.as_ref(),
                &events,
                stop.clone(),
            )
            .await?;
            if !self.reserve(true)? {
                return Ok(());
            }
            self.priority.prepare(
                receive_state::Batch {
                    events: events.clone(),
                    ..Default::default()
                },
                events,
                &identities,
                policy.max_message_bytes,
            )?;
        }
        self.send(true, |scope| async move {
            if let Some(outcome) = self
                .priority
                .publish(
                    &self.rooms()?,
                    policy.max_message_bytes,
                    |_| true,
                    scope.clone(),
                )
                .await?
            {
                self.finish(outcome, true, scope).await?;
            }
            Ok(())
        })
        .await?;
        Ok(())
    }
    pub(super) async fn publish(&self) -> Result<()> {
        loop {
            if self.hooks.stop.is_cancelled() {
                return self.hooks.check();
            }
            let generation = self.resources.control.current()?;
            let cycle = async {
                let pending =
                    self.chat.pending()? || self.priority.pending()? || self.controls.pending()?;
                if !self.reserve(pending)? {
                    self.wait(1000).await?;
                    return Ok(());
                }
                self.hooks.pending.store(
                    pending
                        || self.controlled.pending()?
                        || self.scheduled.pending()?
                        || self.queries.is_pending()?,
                    Ordering::Release,
                );
                if !generation.active {
                    if self.chat.pending()? && !self.chat.recovering()? {
                        self.chat.discard_unpublished()?;
                    }
                    self.wait(1000).await?;
                    return Ok(());
                }
                if !self
                    .state
                    .lock()
                    .map_err(|_| invalid("Receiver ownership failed"))?
                    .synchronized
                {
                    self.wait(1000).await?;
                    return Ok(());
                }
                if self
                    .state
                    .lock()
                    .map_err(|_| invalid("Receiver ownership failed"))?
                    .controlling
                {
                    self.wait(1000).await?;
                    return Ok(());
                }
                if self.priority.pending()? {
                    self.send(true, |scope| async move {
                        if let Some(outcome) =
                            self.priority.recover(&self.rooms()?, scope.clone()).await?
                        {
                            self.finish(outcome, true, scope).await?;
                        }
                        Ok(())
                    })
                    .await?;
                }
                if self.controls.urgent()?.is_some() || self.controls.paused()? {
                    match self.queries.recover(self.hooks.stop.clone()).await {
                        Ok(events) => self.hooks.reporter.record(&events, true)?,
                        Err(error) if error.code == ErrorCode::Conflict => {
                            self.wait(1000).await?;
                            return Ok(());
                        }
                        Err(error) => return Err(error),
                    }
                    if !self.queries.discard_prepared()? {
                        self.wait(1000).await?;
                        return Ok(());
                    }
                }
                if !self.controls.paused()?
                    && let Some(urgent) = self.controls.urgent()?
                {
                    self.urgent(urgent, self.hooks.stop.clone()).await?;
                    return Ok(());
                }
                if self.queries.is_pending()? {
                    let seen = self.queries.recover(self.hooks.stop.clone()).await?;
                    self.hooks.reporter.record(&seen, true)?;
                    self.wait(1000).await?;
                    return Ok(());
                }
                if self.chat.pending()? {
                    let policy = self.policy()?;
                    self.send(false, |scope| async move {
                        let outcome = self
                            .chat
                            .publish(
                                &self.rooms()?,
                                policy.max_message_bytes,
                                |event| self.accept(event),
                                scope.clone(),
                            )
                            .await?;
                        if let Some(outcome) = outcome {
                            self.finish(outcome, false, scope).await?;
                        }
                        Ok(())
                    })
                    .await?;
                    return Ok(());
                }
                if self.controls.paused()? {
                    self.wait(1000).await?;
                    return Ok(());
                }
                let Some(run) = self.hooks.reporter.run()? else {
                    self.wait(1000).await?;
                    return Ok(());
                };
                let maximum = self.policy()?.max_message_bytes;
                if self.controlled.pending()? {
                    self.send(false, |scope| self.controlled.publish(maximum, scope))
                        .await?;
                    return Ok(());
                }
                if self.updates.pending()?
                    && self.native.current()?.phase == crate::runtime::Phase::Running
                {
                    self.send(false, |scope| {
                        self.updates.publish(self.native.as_ref(), scope)
                    })
                    .await?;
                    return Ok(());
                }
                let ordinary = self
                    .state
                    .lock()
                    .map_err(|_| invalid("Receiver ownership failed"))?
                    .ordinary
                    .clone();
                let scheduled = tokio::select! {
                    biased;
                    _ = ordinary.cancelled() => false,
                    _ = self.hooks.stop.cancelled() => return self.hooks.check(),
                    result = self.scheduled.prepare(&run, ordinary.clone()) => result?,
                };
                if scheduled {
                    self.send(false, |scope| async move {
                        self.scheduled.publish(&run, maximum, scope).await?;
                        Ok(())
                    })
                    .await?;
                }
                if self
                    .maintenance
                    .publish(self.resources.matrix.as_ref(), self.hooks.stop.clone())
                    .await?
                {
                    self.state
                        .lock()
                        .map_err(|_| invalid("Receiver ownership failed"))?
                        .access_at = None;
                }
                let ordinary = self
                    .state
                    .lock()
                    .map_err(|_| invalid("Receiver ownership failed"))?
                    .ordinary
                    .clone();
                let acquisition = async {
                    let _budget = self
                        .resources
                        .budget
                        .acquire(Work::Acquisition, ordinary.clone(), false)
                        .await?;
                    self.prepare(ordinary.clone()).await
                };
                tokio::select! { biased; _ = self.hooks.stop.cancelled() => return self.hooks.check(), _ = generation.generation.cancelled() => {}, _ = ordinary.cancelled() => {}, result = acquisition => result?, }
                if !self.hooks.observer.busy()? && !self.gate.publishing()? {
                    let mut protected = receive_snapshots::content_files(
                        self.resources.storage.as_ref(),
                        &self.options.file,
                    )?;
                    protected.extend(self.queries.content_files()?);
                    protected.extend(self.chat.content_files()?);
                    protected.extend(self.priority.content_files()?);
                    self.artifacts.cleanup(false, &protected)?;
                }
                self.wait(self.options.poll_ms.min(self.scheduled.wait_ms()?))
                    .await?;
                Ok(())
            };
            let result: Result<()> = cycle.await;
            if let Err(error) = result {
                (self.resources.diagnostic)(&error);
                if matches!(
                    error.code,
                    ErrorCode::Native | ErrorCode::Unavailable | ErrorCode::BodyTooLarge
                ) {
                    self.wait(self.options.poll_ms.min(5000)).await?;
                } else {
                    return Err(error);
                }
            }
        }
    }
}
