use super::{
    control::{ControlView, authorized_fleet, connection_view, control_view, live_connection},
    runtime,
    values::FleetActor,
};
use crate::{
    identity::{Page, Status},
    port::{AgentRepository, Audit, AuditActor},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
pub const LIFETIME_MS: i64 = 600000;
pub const MAX_BYTES: usize = 16384;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub id: String,
    pub fleet_id: String,
    pub author_principal_id: Option<String>,
    pub author_credential_id: Option<String>,
    pub body: String,
    pub created_at: i64,
    pub expires_at: i64,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryState {
    Pending,
    Delivered,
    Failed,
    Skipped,
}
impl DeliveryState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Delivered => "delivered",
            Self::Failed => "failed",
            Self::Skipped => "skipped",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Delivery {
    pub message_id: String,
    pub agent_id: String,
    pub state: DeliveryState,
    pub completed_at: Option<i64>,
    pub error_message: Option<String>,
}
pub struct Summary {
    pub message: Message,
    pub total: i64,
    pub delivered: i64,
    pub failed: i64,
    pub skipped: i64,
    pub pending: i64,
    pub expired: i64,
}
pub struct Command {
    pub message: Message,
    pub sender_backend_user_id: Option<String>,
    pub agent_ids: Vec<String>,
}
pub struct Snapshot {
    pub control: ControlView,
    pub agent_ids: Vec<String>,
    pub messages: Vec<Command>,
    pub runtime_operations: Vec<runtime::Operation>,
}
pub struct Create<'a> {
    pub id: &'a str,
    pub body: &'a str,
}
pub struct Receipt<'a> {
    pub fleet: &'a str,
    pub message: &'a str,
    pub agent: &'a str,
    pub state: DeliveryState,
    pub error_message: Option<&'a str>,
}
pub trait MessageRepository: runtime::Repository + AgentRepository {
    fn fleet_message(&mut self, id: &str) -> Result<Option<Message>>;
    fn insert_fleet_message(&mut self, value: &Message) -> Result<()>;
    fn fleet_messages_page(&mut self, id: &str, page: i64, size: i64) -> Result<Page<Message>>;
    fn fleet_message_deliveries(&mut self, ids: &[String]) -> Result<Vec<Delivery>>;
    fn fleet_message_delivery(&mut self, id: &str, agent: &str) -> Result<Option<Delivery>>;
    fn save_fleet_message_delivery(&mut self, value: &Delivery, insert: bool) -> Result<()>;
    fn pending_fleet_messages(&mut self, fleet: &str, now: i64) -> Result<Vec<String>>;
}
pub fn summary(message: Message, deliveries: &[Delivery], now: i64) -> Summary {
    let count = |state| {
        deliveries
            .iter()
            .filter(|value| value.message_id == message.id && value.state == state)
            .count() as i64
    };
    let pending = count(DeliveryState::Pending);
    let expired = message.expires_at <= now;
    Summary {
        total: deliveries
            .iter()
            .filter(|value| value.message_id == message.id)
            .count() as i64,
        delivered: count(DeliveryState::Delivered),
        failed: count(DeliveryState::Failed),
        skipped: count(DeliveryState::Skipped),
        pending: if expired { 0 } else { pending },
        expired: if expired { pending } else { 0 },
        message,
    }
}
pub fn create(
    repo: &mut impl MessageRepository,
    actor: &FleetActor,
    fleet: &str,
    input: Create<'_>,
    request: &str,
    now: i64,
) -> Result<Summary> {
    if input
        .body
        .trim_matches(crossfire_kernel::text::whitespace)
        .is_empty()
        || input.body.encode_utf16().count() > 4096
        || input.body.len() > MAX_BYTES
        || input.body.chars().any(
            |value| matches!(value,'\u{0}'..='\u{8}'|'\u{b}'|'\u{c}'|'\u{e}'..='\u{1f}'|'\u{7f}'),
        )
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Fleet message must contain plain text of 1–4096 characters and at most 16 KiB",
        ));
    }
    repo.transaction(|repo| {
        let fleet = authorized_fleet(repo, actor, fleet, true, now)?;
        let (author_principal_id, author_credential_id) = match actor {
            FleetActor::Principal(actor) => (Some(actor.principal_id.clone()), None),
            FleetActor::Controller { credential_id, .. } => (None, Some(credential_id.clone())),
        };
        if let Some(previous) = repo.fleet_message(input.id)? {
            if previous.fleet_id != fleet.id
                || previous.body != input.body
                || previous.author_principal_id != author_principal_id
                || previous.author_credential_id != author_credential_id
            {
                return Err(Failure::new(
                    ErrorCode::Conflict,
                    "Message ID belongs to a different request",
                ));
            }
            let deliveries = repo.fleet_message_deliveries(std::slice::from_ref(&previous.id))?;
            return Ok(summary(previous, &deliveries, now));
        }
        if !fleet.delivery_enabled
            || !connection_view(repo.fleet_connection(&fleet.id)?.as_ref(), now).online
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Activate this fleet and connect its controller before sending a message",
            ));
        }
        if repo.pending_fleet_messages(&fleet.id, now)?.len() >= 32 {
            return Err(Failure::new(
                ErrorCode::Capacity,
                "This fleet already has 32 pending messages",
            ));
        }
        let instances = repo.current_fleet_instances(&fleet)?;
        if instances.is_empty() {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "This fleet has no enrolled agents",
            ));
        }
        if instances.len() > 100 {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Fleet roster is incomplete or exceeds its bound",
            ));
        }
        let message = Message {
            id: input.id.to_owned(),
            fleet_id: fleet.id.clone(),
            author_principal_id,
            author_credential_id,
            body: input.body.to_owned(),
            created_at: now,
            expires_at: now.checked_add(LIFETIME_MS).ok_or_else(|| {
                Failure::new(
                    ErrorCode::Limit,
                    "Fleet message expiry exceeds native range",
                )
            })?,
        };
        repo.insert_fleet_message(&message)?;
        let mut deliveries = Vec::with_capacity(instances.len());
        for instance in instances {
            let view = repo.agent_view(&instance.agent_id)?.ok_or_else(|| {
                Failure::new(
                    ErrorCode::Conflict,
                    "Fleet roster is incomplete or exceeds its bound",
                )
            })?;
            let active = view.principal.status == Status::Active;
            let delivery = Delivery {
                message_id: message.id.clone(),
                agent_id: instance.agent_id,
                state: if active {
                    DeliveryState::Pending
                } else {
                    DeliveryState::Skipped
                },
                completed_at: if active { None } else { Some(now) },
                error_message: if active {
                    None
                } else {
                    Some("Agent account is not active".to_owned())
                },
            };
            repo.save_fleet_message_delivery(&delivery, true)?;
            deliveries.push(delivery);
        }
        let mut audit = match actor {
            FleetActor::Principal(actor) => Audit::new(
                actor,
                request,
                "fleet",
                &fleet.id,
                "fleet.message.create",
                Some(&fleet.owner_id),
                now,
            ),
            FleetActor::Controller { credential_id, .. } => Audit {
                actor: AuditActor::Controller {
                    credential_id: credential_id.clone(),
                },
                request_id: request.to_owned(),
                target_kind: "fleet".to_owned(),
                target_id: fleet.id.clone(),
                action: "fleet.message.create".to_owned(),
                owner_id: Some(fleet.owner_id.clone()),
                created_at: now,
                message: String::new(),
                room_id: None,
                membership_generation: None,
                authorizer_id: None,
                added_by_id: None,
                permission_code: None,
            },
        };
        audit.message = message.id.clone();
        repo.audit(&audit)?;
        Ok(summary(message, &deliveries, now))
    })
}
pub fn list(
    repo: &mut impl MessageRepository,
    actor: &FleetActor,
    fleet: &str,
    page: i64,
    size: i64,
    now: i64,
) -> Result<Page<Summary>> {
    authorized_fleet(repo, actor, fleet, false, now)?;
    let values = repo.fleet_messages_page(fleet, page, size)?;
    let deliveries = repo.fleet_message_deliveries(
        &values
            .items
            .iter()
            .map(|message| message.id.clone())
            .collect::<Vec<_>>(),
    )?;
    Ok(Page {
        items: values
            .items
            .into_iter()
            .map(|message| summary(message, &deliveries, now))
            .collect(),
        page: values.page,
        page_size: values.page_size,
        total_items: values.total_items,
        total_pages: values.total_pages,
    })
}
pub fn control(
    repo: &mut impl MessageRepository,
    actor: &FleetActor,
    fleet: &str,
    connection: &str,
    now: i64,
) -> Result<Snapshot> {
    let (fleet, connection) = live_connection(repo, actor, fleet, connection, now)?;
    let runtime_operations = repo
        .pending_runtime_operation(&fleet.id)?
        .into_iter()
        .collect();
    let mut snapshot = Snapshot {
        control: control_view(&fleet, Some(&connection), now),
        agent_ids: Vec::new(),
        messages: Vec::new(),
        runtime_operations,
    };
    for instance in repo.current_fleet_instances(&fleet)? {
        if repo.agent_view(&instance.agent_id)?.is_some_and(|view| {
            view.principal.status == Status::Active && view.owner.status == Status::Active
        }) {
            snapshot.agent_ids.push(instance.agent_id);
        }
    }
    if !fleet.delivery_enabled {
        return Ok(snapshot);
    }
    let Some(id) = repo
        .pending_fleet_messages(&fleet.id, now)?
        .into_iter()
        .next()
    else {
        return Ok(snapshot);
    };
    let message = repo
        .fleet_message(&id)?
        .ok_or_else(|| Failure::new(ErrorCode::Unavailable, "Fleet message is missing"))?;
    let deliveries = repo.fleet_message_deliveries(std::slice::from_ref(&id))?;
    let sender_backend_user_id = if let Some(id) = &message.author_principal_id {
        Some(
            repo.principal(id)?
                .ok_or_else(|| {
                    Failure::new(ErrorCode::Unavailable, "Fleet message sender is missing")
                })?
                .backend_user_id,
        )
    } else {
        None
    };
    snapshot.messages.push(Command {
        message,
        sender_backend_user_id,
        agent_ids: deliveries
            .into_iter()
            .filter(|delivery| delivery.state == DeliveryState::Pending)
            .map(|delivery| delivery.agent_id)
            .collect(),
    });
    Ok(snapshot)
}
pub fn acknowledge(
    repo: &mut impl MessageRepository,
    actor: &FleetActor,
    input: Receipt<'_>,
    now: i64,
) -> Result<bool> {
    if !matches!(actor, FleetActor::Controller { .. }) {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Only this fleet controller may report message receipts",
        ));
    }
    if input.state == DeliveryState::Pending
        || (input.state == DeliveryState::Delivered) != input.error_message.is_none()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Only failed/skipped deliveries have an error message",
        ));
    }
    repo.transaction(|repo| {
        authorized_fleet(repo, actor, input.fleet, false, now)?;
        let Some(message) = repo.fleet_message(input.message)? else {
            return Ok(false);
        };
        if message.fleet_id != input.fleet {
            return Err(Failure::new(ErrorCode::Missing, "Fleet message not found"));
        }
        let mut delivery = repo
            .fleet_message_delivery(input.message, input.agent)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Fleet message recipient not found"))?;
        if delivery.state != DeliveryState::Pending {
            return if delivery.state == input.state
                && delivery.error_message.as_deref() == input.error_message
            {
                Ok(true)
            } else {
                Err(Failure::new(
                    ErrorCode::Conflict,
                    "This recipient already has a different final outcome",
                ))
            };
        }
        delivery.state = input.state;
        delivery.error_message = input.error_message.map(str::to_owned);
        delivery.completed_at = Some(now);
        repo.save_fleet_message_delivery(&delivery, false)?;
        Ok(true)
    })
}
