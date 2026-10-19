use super::*;
use crate::{origins, unread};
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
    pub(super) async fn prepare(&self, stop: CancellationToken) -> Result<()> {
        let policy = self.policy()?;
        let allowed = self.rooms()?;
        let (since, mut wake, revision) = {
            let state = self
                .state
                .lock()
                .map_err(|_| invalid("Receiver ownership failed"))?;
            (state.since.clone(), state.wake.clone(), state.revision)
        };
        if wake.as_ref().is_some_and(|wake| {
            !allowed.contains(&wake.room) || !policy.senders.contains(&wake.sender)
        }) {
            receive_snapshots::save_wake(
                self.resources.storage.as_ref(),
                &self.options.file,
                None,
            )?;
            self.state
                .lock()
                .map_err(|_| invalid("Receiver ownership failed"))?
                .wake = None;
            wake = None;
        }
        let cursors = receive_state::load(self.resources.storage.as_ref(), &self.options.file)?;
        let mut batch = receive_snapshots::pending(
            self.resources.storage.as_ref(),
            self.resources.messaging.as_ref(),
            &self.options.profile.settings,
            self.artifacts.as_ref(),
            unread::Options {
                file: &self.options.file,
                limit: self.options.limit,
                maximum: policy.max_message_bytes,
                selector: self.options.room.as_deref(),
                boundary: since.as_deref(),
                allowed: &allowed,
                window: wake.as_ref().map(|wake| unread::Window {
                    cursors: &cursors,
                    ends: &wake.ends,
                }),
            },
            stop.clone(),
        )
        .await?;
        self.hooks.reporter.record(&batch.events, false)?;
        if self.controls.urgent()?.is_some()
            || self.controls.paused()?
            || self
                .state
                .lock()
                .map_err(|_| invalid("Receiver ownership failed"))?
                .controlling
        {
            return Ok(());
        }
        let wake = if let Some(wake) = wake {
            Some(wake)
        } else {
            let trigger = receive_snapshots::wake(
                self.resources.messaging.as_ref(),
                &batch,
                &policy.senders,
                &allowed,
                self.options.room.as_deref(),
                |event| self.accept(event),
                stop.clone(),
            )
            .await?;
            if let Some(trigger) = trigger {
                let now = self.now()?;
                let wait = {
                    let mut state = self
                        .state
                        .lock()
                        .map_err(|_| invalid("Receiver ownership failed"))?;
                    if state.window == 0 {
                        state.window = now.saturating_add(self.options.debounce_ms);
                    }
                    state.window.saturating_sub(now)
                };
                if wait > 0 {
                    self.wait(wait as u64).await?;
                    return Ok(());
                }
                let rooms = allowed
                    .iter()
                    .filter(|room| {
                        self.options
                            .room
                            .as_ref()
                            .is_none_or(|selected| selected == *room)
                            && (self.options.history_mode != HistoryMode::PerRoom
                                || *room == &trigger.room_id)
                    })
                    .cloned()
                    .collect();
                let wake = receive_snapshots::capture(
                    self.resources.messaging.as_ref(),
                    &trigger,
                    &rooms,
                    since
                        .as_deref()
                        .ok_or_else(|| invalid("Wake capture requires a synchronized boundary"))?,
                    stop.clone(),
                )
                .await?;
                receive_snapshots::save_wake(
                    self.resources.storage.as_ref(),
                    &self.options.file,
                    Some(&wake),
                )?;
                {
                    let mut state = self
                        .state
                        .lock()
                        .map_err(|_| invalid("Receiver ownership failed"))?;
                    state.wake = Some(wake.clone());
                    state.window = 0;
                }
                Some(wake)
            } else {
                None
            }
        };
        if let Some(wake) = &wake {
            let eligible = if self.options.history_mode == HistoryMode::PerRoom {
                allowed
                    .intersection(&wake.ends.keys().cloned().collect())
                    .cloned()
                    .collect()
            } else {
                allowed.clone()
            };
            batch
                .events
                .retain(|event| eligible.contains(&event.room_id));
            batch.latest.retain(|room, _| eligible.contains(room));
            batch.more_rooms.retain(|room| eligible.contains(room));
            let mut retained = cursors.clone();
            retained.extend(receive_state::filter(&batch.cursors, &eligible));
            batch.cursors = retained;
            let positions = batch.cursors.clone();
            batch = receive_snapshots::collect(
                self.resources.storage.as_ref(),
                self.resources.messaging.as_ref(),
                &self.options.profile.settings,
                self.artifacts.as_ref(),
                batch,
                unread::Options {
                    file: &self.options.file,
                    limit: self.options.limit,
                    maximum: policy.max_message_bytes,
                    selector: self.options.room.as_deref(),
                    boundary: None,
                    allowed: &eligible,
                    window: Some(unread::Window {
                        cursors: &positions,
                        ends: &wake.ends,
                    }),
                },
                stop.clone(),
            )
            .await?;
        } else if batch.events.iter().any(|event| self.accept(event)) {
            return Ok(());
        }
        if self.controls.urgent()?.is_some()
            || self
                .state
                .lock()
                .map_err(|_| invalid("Receiver ownership failed"))?
                .revision
                != revision
        {
            return Ok(());
        }
        let events: Vec<_> = batch
            .events
            .iter()
            .filter(|event| self.accept(event))
            .cloned()
            .collect();
        if events.is_empty() {
            if batch.cursors == cursors && batch.latest.is_empty() {
                return Ok(());
            }
            let _positions = match self.gate.publication() {
                Ok(lease) => lease,
                Err(error) if error.code == ErrorCode::Conflict => return Ok(()),
                Err(error) => return Err(error),
            };
            receive_state::acknowledge(
                self.resources.storage.as_ref(),
                self.resources.messaging.as_ref(),
                &self.options.file,
                &batch,
                stop,
            )
            .await?;
            self.controls.checkpoint(&batch.events)?;
            return Ok(());
        }
        let events = origins::enrich(
            self.resources.messaging.as_ref(),
            &self.options.profile.account.user_id,
            events,
            stop.clone(),
        )
        .await?;
        let identities =
            crate::coordination::senders(self.resources.coordination.as_ref(), &events, stop)
                .await?;
        if !self.reserve(true)? {
            return Ok(());
        }
        self.chat
            .prepare(batch, events, &identities, policy.max_message_bytes)?;
        Ok(())
    }
}
