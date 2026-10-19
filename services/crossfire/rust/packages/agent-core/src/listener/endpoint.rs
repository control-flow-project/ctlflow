use super::*;
use crate::{history_queries, owner_authority, receive_pages};
use crossfire_domain::messaging_client::MessagingClient;
use serde_json::Value;
use std::pin::Pin;

pub type Reply<'a> = Pin<Box<dyn Future<Output = Result<Value>> + Send + 'a>>;
pub trait ControlEndpoint: Send + Sync {
    fn session(&self) -> &str;
    fn read(&self, input: Value, stop: CancellationToken) -> Reply<'_>;
    fn acknowledge(&self, query: String, stop: CancellationToken) -> Reply<'_>;
    fn test(&self, stop: CancellationToken) -> Reply<'_>;
}
impl<
    S: LocalState,
    C: Coordination,
    M: MessagingClient + crossfire_domain::messaging_client::InvitationReader,
    N: Connection + TurnControl + Lifecycle + 'static,
    A: Acknowledgment,
    T: Clock + Clone + Send + Sync + 'static,
> ControlEndpoint for Receiver<S, C, M, N, A, T>
{
    fn session(&self) -> &str {
        self.native.session_id()
    }
    fn read(&self, input: Value, stop: CancellationToken) -> Reply<'_> {
        Box::pin(async move {
            self.hooks.check()?;
            if self.hooks.stop.is_cancelled() {
                return Err(Failure::new(ErrorCode::Unavailable, "Listener is closed"));
            }
            self.queries
                .read(history_queries::parse(&input)?, stop)
                .await
        })
    }
    fn acknowledge(&self, query: String, stop: CancellationToken) -> Reply<'_> {
        Box::pin(async move {
            self.hooks.check()?;
            if self.hooks.stop.is_cancelled() {
                return Err(Failure::new(ErrorCode::Unavailable, "Listener is closed"));
            }
            let seen = self.queries.acknowledge(&query, stop).await?;
            self.hooks.reporter.record(&seen, true)?;
            self.controls.checkpoint(&seen)?;
            receive_snapshots::save_wake(
                self.resources.storage.as_ref(),
                &self.options.file,
                None,
            )?;
            {
                let mut state = self
                    .state
                    .lock()
                    .map_err(|_| invalid("Receiver ownership failed"))?;
                state.wake = None;
                state.window = 0;
            }
            self.changed()?;
            Ok(json!({"accepted":true}))
        })
    }
    fn test(&self, stop: CancellationToken) -> Reply<'_> {
        Box::pin(async move {
            self.hooks.check()?;
            if self.native.current()?.phase == crate::runtime::Phase::Failed {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Native runtime recovery has not completed; its exact saved history remains retained",
                ));
            }
            owner_authority::authorize(
                self.resources.coordination.as_ref(),
                self.resources.messaging.as_ref(),
                &self.options.profile,
                stop.clone(),
            )
            .await?;
            let busy = self.native.inspect().await?;
            let policy = crate::coordination::policy(
                self.resources.coordination.as_ref(),
                &self.options.profile,
                stop.clone(),
            )
            .await?;
            if !policy.active {
                return Err(Failure::new(
                    ErrorCode::Forbidden,
                    "Agent or owner access is inactive",
                ));
            }
            let who = self.resources.messaging.identify(stop.clone()).await?;
            if who != self.options.profile.account.user_id {
                return Err(Failure::new(
                    ErrorCode::Forbidden,
                    "MessagingClient authentication does not match this agent",
                ));
            }
            let joined =
                receive_pages::joined(self.resources.messaging.as_ref(), stop.clone()).await?;
            let rooms: Vec<_> = policy
                .rooms
                .iter()
                .filter(|(_, room)| !room.muted)
                .map(|(room, _)| room)
                .collect();
            if rooms.iter().any(|room| !joined.contains(*room)) {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Granted room access is not applied yet; refresh room access in management and test again",
                ));
            }
            let current = self
                .resources
                .coordination
                .call(&Call::new(OperationId::Release), stop)
                .await?;
            let current = release::parse(&current)?;
            let paused = self.controls.paused()? || !self.resources.control.current()?.active;
            let waking = !policy.senders.is_empty();
            let message = if paused {
                "Listener is connected; delivery is paused."
            } else if rooms.is_empty() {
                "Listener is ready. No unmuted rooms are granted. The owner can open a DM or invite this agent in Element; native approvals open the private DM only when needed."
            } else if !waking {
                "Listener is connected. Wake-up rules disable chat-triggered input; use the runtime directly or change the policy in management."
            } else {
                "Listener, exact runtime session, server authentication and room access are ready."
            };
            Ok(
                json!({"session":self.native.session_id(),"server":self.resources.coordination.origin(),"authenticated":true,"rooms":rooms.len(),"joinedRooms":joined.len(),"canReceiveRoomTasks":!rooms.is_empty() && !paused && waking,"wakeMode":match policy.mode { crossfire_domain::identity::WakeMode::Humans => "humans",crossfire_domain::identity::WakeMode::Everyone => "everyone",crossfire_domain::identity::WakeMode::Selected => "selected" },"busy":busy,"deliveryPaused":paused,"approval":match self.native.approval(){crate::runtime::Approval::None=>"none",crate::runtime::Approval::Runtime=>"runtime",crate::runtime::Approval::Listener=>"listener"},"currentRelease":current.release,"message":message}),
            )
        })
    }
}
