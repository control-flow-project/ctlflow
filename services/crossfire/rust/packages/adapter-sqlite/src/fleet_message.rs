use crate::{
    error::failure,
    store::Store,
    tables::{fleet_message as message, fleet_message_delivery as delivery},
};
use crossfire_domain::{
    fleet::message::{Delivery, DeliveryState, Message, MessageRepository},
    identity::Page,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;
#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name=message)]
struct MessageRow {
    id: String,
    fleet_id: String,
    author_principal_id: Option<String>,
    author_credential_id: Option<String>,
    body: String,
    created_at: i64,
    expires_at: i64,
}
impl From<MessageRow> for Message {
    fn from(value: MessageRow) -> Self {
        Self {
            id: value.id,
            fleet_id: value.fleet_id,
            author_principal_id: value.author_principal_id,
            author_credential_id: value.author_credential_id,
            body: value.body,
            created_at: value.created_at,
            expires_at: value.expires_at,
        }
    }
}
impl From<&Message> for MessageRow {
    fn from(value: &Message) -> Self {
        Self {
            id: value.id.clone(),
            fleet_id: value.fleet_id.clone(),
            author_principal_id: value.author_principal_id.clone(),
            author_credential_id: value.author_credential_id.clone(),
            body: value.body.clone(),
            created_at: value.created_at,
            expires_at: value.expires_at,
        }
    }
}
#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name=delivery,treat_none_as_null=true)]
struct DeliveryRow {
    message_id: String,
    agent_id: String,
    status: String,
    completed_at: Option<i64>,
    error_message: Option<String>,
}
impl TryFrom<DeliveryRow> for Delivery {
    type Error = Failure;
    fn try_from(value: DeliveryRow) -> Result<Self> {
        let state = match value.status.as_str() {
            "pending" => DeliveryState::Pending,
            "delivered" => DeliveryState::Delivered,
            "failed" => DeliveryState::Failed,
            "skipped" => DeliveryState::Skipped,
            _ => {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Invalid stored fleet delivery state",
                ));
            }
        };
        Ok(Self {
            message_id: value.message_id,
            agent_id: value.agent_id,
            state,
            completed_at: value.completed_at,
            error_message: value.error_message,
        })
    }
}
impl From<&Delivery> for DeliveryRow {
    fn from(value: &Delivery) -> Self {
        Self {
            message_id: value.message_id.clone(),
            agent_id: value.agent_id.clone(),
            status: value.state.as_str().to_owned(),
            completed_at: value.completed_at,
            error_message: value.error_message.clone(),
        }
    }
}
impl MessageRepository for Store {
    fn fleet_message(&mut self, id: &str) -> Result<Option<Message>> {
        Ok(message::table
            .filter(message::id.eq(id))
            .select(MessageRow::as_select())
            .first::<MessageRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Message::from))
    }
    fn insert_fleet_message(&mut self, value: &Message) -> Result<()> {
        diesel::insert_into(message::table)
            .values(MessageRow::from(value))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn fleet_messages_page(&mut self, id: &str, page: i64, size: i64) -> Result<Page<Message>> {
        if !(1..=100000).contains(&page) || !(1..=100).contains(&size) {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Use page ≥ 1 and pageSize 1–100",
            ));
        }
        let total = message::table
            .filter(message::fleet_id.eq(id))
            .count()
            .get_result::<i64>(self.database.connection())
            .map_err(failure)?;
        let items = message::table
            .filter(message::fleet_id.eq(id))
            .order((message::created_at.desc(), message::id.desc()))
            .limit(size)
            .offset((page - 1) * size)
            .select(MessageRow::as_select())
            .load::<MessageRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Message::from)
            .collect();
        Ok(Page {
            items,
            page,
            page_size: size,
            total_items: total,
            total_pages: (total + size - 1) / size,
        })
    }
    fn fleet_message_deliveries(&mut self, ids: &[String]) -> Result<Vec<Delivery>> {
        delivery::table
            .filter(delivery::message_id.eq_any(ids))
            .order((delivery::message_id.asc(), delivery::agent_id.asc()))
            .select(DeliveryRow::as_select())
            .load::<DeliveryRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Delivery::try_from)
            .collect()
    }
    fn fleet_message_delivery(&mut self, id: &str, agent: &str) -> Result<Option<Delivery>> {
        delivery::table
            .filter(
                delivery::message_id
                    .eq(id)
                    .and(delivery::agent_id.eq(agent)),
            )
            .select(DeliveryRow::as_select())
            .first::<DeliveryRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Delivery::try_from)
            .transpose()
    }
    fn save_fleet_message_delivery(&mut self, value: &Delivery, insert: bool) -> Result<()> {
        let row = DeliveryRow::from(value);
        let count = if insert {
            diesel::insert_into(delivery::table)
                .values(row)
                .execute(self.database.connection())
        } else {
            diesel::update(
                delivery::table.filter(
                    delivery::message_id
                        .eq(&value.message_id)
                        .and(delivery::agent_id.eq(&value.agent_id)),
                ),
            )
            .set(row)
            .execute(self.database.connection())
        }
        .map_err(failure)?;
        if count == 1 {
            Ok(())
        } else {
            Err(Failure::new(
                ErrorCode::Missing,
                "Fleet delivery is missing",
            ))
        }
    }
    fn pending_fleet_messages(&mut self, id: &str, now: i64) -> Result<Vec<String>> {
        message::table
            .inner_join(delivery::table.on(delivery::message_id.eq(message::id)))
            .filter(
                message::fleet_id
                    .eq(id)
                    .and(message::expires_at.gt(now))
                    .and(delivery::status.eq("pending")),
            )
            .select(message::id)
            .distinct()
            .order((message::created_at.asc(), message::id.asc()))
            .load::<String>(self.database.connection())
            .map_err(failure)
    }
}
