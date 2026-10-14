use crate::{
    authorization::authorize,
    identity::{Actor, Status},
    matrix::MatrixAuthority,
    permission::Permission,
    port::{AgentRepository, DiscoveryRepository, RepositoryAccess, UnitOfWork},
    room_access::{port::RoomRepository, values::Access},
    wake,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, time::Clock};
pub const COOLDOWN_MS: i64 = 600000;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Pending,
    Sent,
    Denied,
}
impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Sent => "sent",
            Self::Denied => "denied",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notice {
    pub receiver_agent_id: String,
    pub event_id: String,
    pub sender_matrix_id: String,
    pub room_id: String,
    pub reserved_at: i64,
    pub message_body: String,
    pub state: State,
    pub sent_at: Option<i64>,
    pub native_event_id: Option<String>,
    pub next_attempt_at: Option<i64>,
    pub last_error: Option<String>,
}
pub trait NoticeRepository: RoomRepository + DiscoveryRepository {
    fn wake_notice(&mut self, agent: &str, event: &str) -> Result<Option<Notice>>;
    fn recent_notice(&mut self, agent: &str, sender: &str, since: i64) -> Result<bool>;
    fn save_wake_notice(&mut self, notice: &Notice, insert: bool) -> Result<()>;
    fn due_wake_notices(&mut self, now: i64) -> Result<Vec<Notice>>;
}
pub struct Input<'a> {
    pub actor: &'a Actor,
    pub receiver: &'a str,
    pub room: &'a str,
    pub event: &'a str,
}
pub async fn request<A: RepositoryAccess, M: MatrixAuthority, C: Clock>(
    repository: &A,
    matrix: &M,
    clock: &C,
    input: Input<'_>,
) -> Result<&'static str>
where
    A::Repository: NoticeRepository,
{
    let target = repository.with(|repo| {
        authorize(
            repo,
            input.actor,
            Permission::WakeNoticePublishSelf,
            clock.now()?,
        )?;
        if input.actor.principal_id != input.receiver {
            return Err(Failure::new(
                ErrorCode::Missing,
                "Receiving agent not found",
            ));
        }
        repo.agent_view(input.receiver)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Receiving agent not found"))
    })?;
    let event = matrix
        .event(&target.principal.matrix_user_id, input.room, input.event)
        .await?;
    repository.with(|repo| {
        repo.transaction(|repo| {
            let now = clock.now()?;
            authorize(repo, input.actor, Permission::WakeNoticePublishSelf, now)?;
            let target = repo
                .agent_view(input.receiver)?
                .ok_or_else(|| Failure::new(ErrorCode::Missing, "Receiving agent not found"))?;
            if let Some(previous) = repo.wake_notice(input.receiver, input.event)? {
                return Ok(previous.state.as_str());
            }
            if event.event_id != input.event
                || event.room_id != input.room
                || event.event_type != "m.room.message"
                || event.message_type.as_deref() != Some("m.text")
                || event.edited
                || event.control
                || event.sender_matrix_id == target.principal.matrix_user_id
                || !event.mentions.contains(&target.principal.matrix_user_id)
            {
                return Ok("not-applicable");
            }
            if repo
                .room_grant(input.receiver, input.room)?
                .is_none_or(|grant| {
                    matches!(grant.intent.access, Access::None | Access::Read) || grant.intent.muted
                })
            {
                return Ok("not-permitted");
            }
            if wake::resolve(repo, &target.agent)?.contains(&event.sender_matrix_id) {
                return Ok("not-applicable");
            }
            if repo.recent_notice(
                input.receiver,
                &event.sender_matrix_id,
                now.saturating_sub(COOLDOWN_MS),
            )? {
                return Ok("rate-limited");
            }
            let name = repo.agent_name(input.receiver)?.ok_or_else(|| {
                Failure::new(ErrorCode::Unavailable, "Receiving agent name is missing")
            })?;
            let body = format!(
                "{}, {name} won’t wake under its current rules. {} ({}) can change them.",
                event.sender_matrix_id,
                target.owner_member.display_name,
                target.owner.matrix_user_id
            );
            repo.save_wake_notice(
                &Notice {
                    receiver_agent_id: input.receiver.to_owned(),
                    event_id: input.event.to_owned(),
                    sender_matrix_id: event.sender_matrix_id,
                    room_id: input.room.to_owned(),
                    reserved_at: now,
                    message_body: body,
                    state: State::Pending,
                    sent_at: None,
                    native_event_id: None,
                    next_attempt_at: Some(now),
                    last_error: None,
                },
                true,
            )?;
            Ok("pending")
        })
    })
}
pub async fn publish<A: RepositoryAccess, M: MatrixAuthority, C: Clock>(
    repository: &A,
    matrix: &M,
    clock: &C,
    agent: &str,
    event: &str,
) -> Result<()>
where
    A::Repository: NoticeRepository,
{
    let Some(notice) = repository
        .with(|repo| repo.wake_notice(agent, event))?
        .filter(|notice| notice.state == State::Pending)
    else {
        return Ok(());
    };
    let recipient = repository.with(|repo| {
        let target = repo.agent_view(agent)?;
        let grant = repo.room_grant(agent, &notice.room_id)?;
        let target = target.filter(|target| {
            target.principal.status == Status::Active && target.owner.status == Status::Active
        });
        if target.is_none()
            || grant.is_none_or(|grant| {
                matches!(grant.intent.access, Access::None | Access::Read) || grant.intent.muted
            })
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "The receiver no longer permits a room notice",
            ));
        }
        let target = target.ok_or_else(|| {
            Failure::new(
                ErrorCode::Forbidden,
                "The receiver no longer permits a room notice",
            )
        })?;
        if wake::resolve(repo, &target.agent)?.contains(&notice.sender_matrix_id)
            && notice.last_error.is_none()
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "The sender now has wake authority",
            ));
        }
        Ok(target.principal.matrix_user_id)
    });
    let result = match recipient {
        Ok(user) => {
            matrix
                .send_notice(
                    &user,
                    &notice.room_id,
                    &identity::hash(&format!("wake-notice:{agent}:{event}")),
                    &notice.message_body,
                    &notice.sender_matrix_id,
                )
                .await
        }
        Err(error) => Err(error),
    };
    repository.with(|repo| {
        repo.transaction(|repo| {
            let Some(mut current) = repo
                .wake_notice(agent, event)?
                .filter(|notice| notice.state == State::Pending)
            else {
                return Ok(());
            };
            let now = clock.now()?;
            match result {
                Ok(id) => {
                    current.state = State::Sent;
                    current.sent_at = Some(now);
                    current.native_event_id = Some(id);
                    current.next_attempt_at = None;
                    current.last_error = None;
                }
                Err(error) => {
                    let denied = error.code == ErrorCode::Forbidden && notice.last_error.is_none();
                    current.state = if denied {
                        State::Denied
                    } else {
                        State::Pending
                    };
                    current.sent_at = None;
                    current.native_event_id = None;
                    current.next_attempt_at = if denied {
                        None
                    } else {
                        Some(now.checked_add(30000).ok_or_else(|| {
                            Failure::new(ErrorCode::Limit, "Notice retry exceeds native range")
                        })?)
                    };
                    current.last_error = Some(error.message);
                }
            }
            repo.save_wake_notice(&current, false)
        })
    })
}
