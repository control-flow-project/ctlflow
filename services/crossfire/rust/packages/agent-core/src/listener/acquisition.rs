use super::*;
use crate::{
    coordination, events, origins, receive_pages, source_control, source_events, steering,
};

impl<
    S: LocalState,
    C: Coordination,
    M: Matrix,
    N: Connection + TurnControl + Lifecycle + 'static,
    A: Acknowledgment,
    T: Clock + Clone + Send + Sync + 'static,
> Receiver<S, C, M, N, A, T>
{
    pub(super) async fn refresh(&self, stop: CancellationToken) -> Result<()> {
        let _owner = self.access.lock().await;
        let next = coordination::policy(
            self.resources.coordination.as_ref(),
            &self.options.profile,
            stop,
        )
        .await?;
        if !next.active {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Agent or owner access is no longer active",
            ));
        }
        self.native.configure_idle(
            i64::try_from(next.idle_timeout_seconds)
                .map_err(|_| invalid("Native idle duration overflow"))?,
        )?;
        let previous = self.policy()?;
        if next.rooms != previous.rooms || next.senders != previous.senders {
            self.cancel_delivery().await?;
            let retired: BTreeSet<_> = previous
                .rooms
                .keys()
                .filter(|room| next.room(room).is_none_or(|room| room.muted))
                .cloned()
                .collect();
            receive_snapshots::retire(
                self.resources.storage.as_ref(),
                &self.options.file,
                &retired,
            )?;
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Receiver ownership failed"))?;
            state.retired.extend(retired);
            state.revision = state.revision.wrapping_add(1);
        }
        self.hooks
            .maximum
            .store(next.max_message_bytes, Ordering::Release);
        {
            let mut state = self
                .state
                .lock()
                .map_err(|_| invalid("Receiver ownership failed"))?;
            state.policy = next;
            state.access_at = Some(self.now()?);
        }
        Ok(())
    }
    async fn source(&self, event: Event, stop: CancellationToken) -> Result<()> {
        self.hooks
            .reporter
            .record(std::slice::from_ref(&event), false)?;
        if self.controls.contains(&event)?
            || self
                .options
                .room
                .as_ref()
                .is_some_and(|room| room != &event.room_id)
        {
            return Ok(());
        }
        let event = origins::enrich(
            self.resources.matrix.as_ref(),
            &self.options.profile.account.user_id,
            vec![event],
            stop.clone(),
        )
        .await?
        .pop()
        .ok_or_else(|| invalid("Received event is missing"))?;
        let native = steering::source(&event)?;
        let candidate = crossfire_contracts::matrix_event::mentions_agent(
            &native,
            &self.options.profile.account.user_id,
        ) || event.sender == self.options.profile.settings.owner
            && event.content["body"]
                .as_str()
                .is_some_and(|body| body.trim() == "!!")
            || event.origin.kind == events::Kind::Dm;
        if candidate {
            self.refresh(stop.clone()).await?;
        }
        let policy = self.policy()?;
        if policy.room(&event.room_id).is_none_or(|room| room.muted) {
            return Ok(());
        }
        if !policy.senders.contains(&event.sender)
            && crossfire_contracts::matrix_event::mentions_agent(
                &native,
                &self.options.profile.account.user_id,
            )
        {
            self.maintenance.notice(&event)?;
        }
        if !steering::authorized(
            self.resources.matrix.as_ref(),
            self.resources.coordination.as_ref(),
            &self.options.profile,
            &event,
            &policy.senders,
            stop.clone(),
        )
        .await?
        {
            if self.controls.paused()?
                && event.sender == self.options.profile.settings.owner
                && event.content["msgtype"] == "m.text"
                && !native.edited
                && !native.control
            {
                self.controls.resume()?;
                self.changed()?;
            }
            return Ok(());
        }
        let ordinary = self
            .state
            .lock()
            .map_err(|_| invalid("Receiver ownership failed"))?
            .ordinary
            .clone();
        ordinary.cancel();
        self.gate.interrupt_query()?;
        let interruption = self
            .controls
            .interrupt(
                source_control::Interrupt {
                    matrix: self.resources.matrix.as_ref(),
                    coordination: self.resources.coordination.as_ref(),
                    native: self.native.as_ref(),
                    notices: &self.receipts,
                    profile: &self.options.profile,
                    event,
                    allowed: &self.rooms()?,
                    senders: &policy.senders,
                    per_room: self.options.history_mode == HistoryMode::PerRoom,
                },
                stop,
            )
            .await;
        self.cancel_delivery().await?;
        interruption?;
        self.changed()?;
        Ok(())
    }
    pub(super) async fn acquire(&self) -> Result<()> {
        loop {
            if self.hooks.stop.is_cancelled() {
                return self.hooks.check();
            }
            self.resources.control.wait(self.hooks.stop.clone()).await?;
            let control = self.resources.control.current()?;
            let since = self
                .state
                .lock()
                .map_err(|_| invalid("Receiver ownership failed"))?
                .since
                .clone();
            let scope = control.generation.child_token();
            let acquisition = async {
                let sync = receive_pages::sync(
                    self.resources.matrix.as_ref(),
                    since.as_deref(),
                    self.options
                        .poll_ms
                        .min(self.options.reconcile_ms as u64 / 2) as u32,
                    scope.clone(),
                )
                .await?;
                let mut sync = source_events::parse(sync)?;
                self.state
                    .lock()
                    .map_err(|_| invalid("Receiver ownership failed"))?
                    .controlling = true;
                let joined =
                    receive_pages::joined(self.resources.matrix.as_ref(), scope.clone()).await?;
                let previous = self
                    .state
                    .lock()
                    .map_err(|_| invalid("Receiver ownership failed"))?
                    .joined
                    .clone();
                let now = self.now()?;
                let due = self
                    .state
                    .lock()
                    .map_err(|_| invalid("Receiver ownership failed"))?
                    .access_at
                    .is_none_or(|at| now.saturating_sub(at) >= self.options.reconcile_ms);
                if previous != joined || due {
                    self.refresh(scope.clone()).await?;
                }
                let mut reset: BTreeSet<_> = previous.difference(&joined).cloned().collect();
                reset.extend(
                    source_events::membership_resets(
                        self.resources.matrix.as_ref(),
                        &sync,
                        since.as_deref(),
                        &self.options.profile.account.user_id,
                        scope.clone(),
                    )
                    .await?,
                );
                if !reset.is_empty() {
                    self.cancel_delivery().await?;
                    source_events::reset_rooms(
                        self.resources.storage.as_ref(),
                        &self.options.file,
                        &reset,
                    )?;
                    self.controls.retire(&reset)?;
                }
                receive_state::retain_joined(
                    self.resources.storage.as_ref(),
                    &self.options.file,
                    &joined,
                )?;
                if !sync.invited.is_empty() || !sync.left.is_empty() {
                    self.maintenance.observe()?;
                }
                let next = sync.next.clone();
                sync.joined.retain(|room, _| {
                    previous.contains(room) && joined.contains(room) && !reset.contains(room)
                });
                source_events::incremental(
                    self.resources.matrix.as_ref(),
                    sync,
                    since.as_deref(),
                    "m.room.message",
                    scope.clone(),
                    |event| self.source(event, scope.clone()),
                )
                .await?;
                receive_state::checkpoint_sync(
                    self.resources.storage.as_ref(),
                    &self.options.file,
                    &next,
                )?;
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| invalid("Receiver ownership failed"))?;
                if previous != joined || !reset.is_empty() {
                    state.revision = state.revision.wrapping_add(1);
                }
                state.retired.extend(reset);
                state.wake = receive_snapshots::load_wake(
                    self.resources.storage.as_ref(),
                    &self.options.file,
                )?;
                state.joined = joined;
                state.since = Some(next);
                state.synchronized = true;
                state.controlling = false;
                if state.ordinary.is_cancelled() {
                    state.ordinary = CancellationToken::new();
                }
                Ok(())
            };
            let result = tokio::select! { biased;
                _ = self.hooks.stop.cancelled() => return self.hooks.check(),
                _ = control.generation.cancelled() => Ok(()),
                result = tokio::time::timeout(Duration::from_millis(self.options.reconcile_ms as u64), acquisition) => result.map_err(|_| Failure::new(ErrorCode::Unavailable, "Listener acquisition exceeded its reconciliation deadline; unread positions remain retained")).and_then(|result| result),
            };
            scope.cancel();
            self.state
                .lock()
                .map_err(|_| invalid("Receiver ownership failed"))?
                .controlling = false;
            self.changed()?;
            if let Err(error) = result {
                (self.resources.diagnostic)(&error);
                if self.controls.interrupting()? {
                    return Err(error);
                }
                if !matches!(
                    error.code,
                    ErrorCode::Native | ErrorCode::Unavailable | ErrorCode::BodyTooLarge
                ) {
                    return Err(error);
                }
                self.wait(self.options.poll_ms.min(5000)).await?;
            }
        }
    }
}
