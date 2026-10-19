use crate::{error::failure, store::Store, tables::wake_notice};
use crossfire_domain::notice::{Notice, NoticeRepository, State};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::{dsl::exists, prelude::*};
#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name=wake_notice,treat_none_as_null=true)]
struct Row {
    receiver_agent_id: String,
    event_id: String,
    sender_backend_user_id: String,
    room_id: String,
    reserved_at: i64,
    message_body: String,
    status: String,
    sent_at: Option<i64>,
    native_event_id: Option<String>,
    next_attempt_at: Option<i64>,
    last_error: Option<String>,
}
impl From<&Notice> for Row {
    fn from(value: &Notice) -> Self {
        Self {
            receiver_agent_id: value.receiver_agent_id.clone(),
            event_id: value.event_id.clone(),
            sender_backend_user_id: value.sender_backend_user_id.clone(),
            room_id: value.room_id.clone(),
            reserved_at: value.reserved_at,
            message_body: value.message_body.clone(),
            status: value.state.as_str().to_owned(),
            sent_at: value.sent_at,
            native_event_id: value.native_event_id.clone(),
            next_attempt_at: value.next_attempt_at,
            last_error: value.last_error.clone(),
        }
    }
}
impl TryFrom<Row> for Notice {
    type Error = Failure;
    fn try_from(row: Row) -> Result<Self> {
        let state = match row.status.as_str() {
            "pending" => State::Pending,
            "sent" => State::Sent,
            "denied" => State::Denied,
            _ => {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Invalid stored wake notice state",
                ));
            }
        };
        Ok(Self {
            receiver_agent_id: row.receiver_agent_id,
            event_id: row.event_id,
            sender_backend_user_id: row.sender_backend_user_id,
            room_id: row.room_id,
            reserved_at: row.reserved_at,
            message_body: row.message_body,
            state,
            sent_at: row.sent_at,
            native_event_id: row.native_event_id,
            next_attempt_at: row.next_attempt_at,
            last_error: row.last_error,
        })
    }
}
impl NoticeRepository for Store {
    fn wake_notice(&mut self, agent: &str, room: &str, event: &str) -> Result<Option<Notice>> {
        wake_notice::table
            .filter(
                wake_notice::receiver_agent_id
                    .eq(agent)
                    .and(wake_notice::room_id.eq(room))
                    .and(wake_notice::event_id.eq(event)),
            )
            .select(Row::as_select())
            .first::<Row>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Notice::try_from)
            .transpose()
    }
    fn recent_notice(&mut self, agent: &str, sender: &str, since: i64) -> Result<bool> {
        diesel::select(exists(
            wake_notice::table.filter(
                wake_notice::receiver_agent_id
                    .eq(agent)
                    .and(wake_notice::sender_backend_user_id.eq(sender))
                    .and(wake_notice::reserved_at.ge(since)),
            ),
        ))
        .get_result(self.database.connection())
        .map_err(failure)
    }
    fn save_wake_notice(&mut self, value: &Notice, insert: bool) -> Result<()> {
        let row = Row::from(value);
        let count = if insert {
            diesel::insert_into(wake_notice::table)
                .values(row)
                .execute(self.database.connection())
        } else {
            diesel::update(
                wake_notice::table.filter(
                    wake_notice::receiver_agent_id
                        .eq(&value.receiver_agent_id)
                        .and(wake_notice::room_id.eq(&value.room_id))
                        .and(wake_notice::event_id.eq(&value.event_id)),
                ),
            )
            .set(row)
            .execute(self.database.connection())
        }
        .map_err(failure)?;
        if count == 1 {
            Ok(())
        } else {
            Err(Failure::new(ErrorCode::Missing, "Wake notice is missing"))
        }
    }
    fn due_wake_notices(&mut self, now: i64) -> Result<Vec<Notice>> {
        wake_notice::table
            .filter(
                wake_notice::status
                    .eq("pending")
                    .and(wake_notice::next_attempt_at.le(now)),
            )
            .order((
                wake_notice::next_attempt_at.asc(),
                wake_notice::receiver_agent_id.asc(),
                wake_notice::event_id.asc(),
            ))
            .select(Row::as_select())
            .load::<Row>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Notice::try_from)
            .collect()
    }
}
