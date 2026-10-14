use super::store::Store;
use crate::{error::failure, tables::listener_run};
use crossfire_domain::{
    listener::{Controller, Run},
    port::ListenerRepository,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = listener_run, treat_none_as_null = true)]
pub(crate) struct ListenerRow {
    controller_fleet_id: Option<String>,
    controller_connection_id: Option<String>,
    controller_credential_id: Option<String>,
    id: String,
    agent_id: String,
    release: Option<String>,
    started_at: i64,
    last_seen_at: i64,
    active_ms: i64,
    messages_delivered: i64,
    stopped_at: Option<i64>,
    disconnect_requested_at: Option<i64>,
}

impl ListenerRepository for Store {
    fn listener_run(&mut self, id: &str) -> Result<Option<Run>> {
        let row = listener_run::table
            .filter(listener_run::id.eq(id))
            .select(ListenerRow::as_select())
            .first::<ListenerRow>(self.database.connection())
            .optional()
            .map_err(failure)?;
        row.map(Run::try_from).transpose()
    }
    fn save_listener_run(&mut self, value: &Run, insert: bool) -> Result<()> {
        let row = ListenerRow {
            controller_fleet_id: value
                .controller
                .as_ref()
                .map(|controller| controller.fleet_id.clone()),
            controller_connection_id: value
                .controller
                .as_ref()
                .map(|controller| controller.connection_id.clone()),
            controller_credential_id: value
                .controller
                .as_ref()
                .map(|controller| controller.credential_id.clone()),
            id: value.id.clone(),
            agent_id: value.agent_id.clone(),
            release: value.release.clone(),
            started_at: value.started_at,
            last_seen_at: value.last_seen_at,
            active_ms: value.active_ms,
            messages_delivered: value.messages_delivered,
            stopped_at: value.stopped_at,
            disconnect_requested_at: value.disconnect_requested_at,
        };
        let changed = if insert {
            diesel::insert_into(listener_run::table)
                .values(&row)
                .execute(self.database.connection())
        } else {
            diesel::update(listener_run::table.filter(listener_run::id.eq(&value.id)))
                .set(&row)
                .execute(self.database.connection())
        }
        .map_err(failure)?;
        if changed == 1 {
            Ok(())
        } else {
            Err(Failure::new(ErrorCode::Missing, "Listener run not found"))
        }
    }
    fn active_listener_count(&mut self, id: &str, since: i64, now: i64) -> Result<i64> {
        use crate::tables::fleet_connection;
        listener_run::table
            .inner_join(
                fleet_connection::table.on(fleet_connection::fleet_id
                    .nullable()
                    .eq(listener_run::controller_fleet_id)
                    .and(
                        fleet_connection::connection_id
                            .nullable()
                            .eq(listener_run::controller_connection_id),
                    )
                    .and(
                        fleet_connection::credential_id
                            .nullable()
                            .eq(listener_run::controller_credential_id),
                    )),
            )
            .filter(
                listener_run::agent_id
                    .eq(id)
                    .and(listener_run::stopped_at.is_null())
                    .and(listener_run::last_seen_at.gt(since)),
            )
            .filter(
                fleet_connection::closed_at
                    .is_null()
                    .and(fleet_connection::expires_at.gt(now)),
            )
            .count()
            .get_result(self.database.connection())
            .map_err(failure)
    }
}

impl TryFrom<ListenerRow> for Run {
    type Error = Failure;
    fn try_from(row: ListenerRow) -> Result<Self> {
        let controller = match (
            row.controller_fleet_id,
            row.controller_connection_id,
            row.controller_credential_id,
        ) {
            (Some(fleet_id), Some(connection_id), Some(credential_id)) => Some(Controller {
                fleet_id,
                connection_id,
                credential_id,
            }),
            (None, None, None) if row.stopped_at.is_some() => None,
            _ => {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Stored controller generation is invalid",
                ));
            }
        };
        Ok(Self {
            controller,
            id: row.id,
            agent_id: row.agent_id,
            release: row.release,
            started_at: row.started_at,
            last_seen_at: row.last_seen_at,
            active_ms: row.active_ms,
            messages_delivered: row.messages_delivered,
            stopped_at: row.stopped_at,
            disconnect_requested_at: row.disconnect_requested_at,
        })
    }
}
