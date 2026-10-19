use super::stored_code;
use crate::{
    error::failure,
    tables::{
        fleet, fleet_connection, incident_notification, listener_run, management_conversation,
        runtime_incident,
    },
};
use crate::{
    fleet::{ConnectionRow, FleetRow},
    listener::ListenerRow,
    store::Store,
};
use crossfire_domain::{
    fleet::values::{Connection, Fleet},
    listener::Run,
    runtime::{port::IncidentRepository, values::*},
};
use crossfire_kernel::{Failure, Result};
use diesel::{
    dsl::{exists, not},
    prelude::*,
};

#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = runtime_incident)]
struct IncidentRow {
    id: String,
    owner_id: String,
    agent_id: Option<String>,
    fleet_id: Option<String>,
    run_id: Option<String>,
    session_id: Option<String>,
    kind: String,
    message: String,
    created_at: i64,
    recovered_at: Option<i64>,
}

impl TryFrom<IncidentRow> for Incident {
    type Error = Failure;
    fn try_from(value: IncidentRow) -> Result<Self> {
        Ok(Self {
            id: value.id,
            owner_id: value.owner_id,
            agent_id: value.agent_id,
            fleet_id: value.fleet_id,
            run_id: value.run_id,
            session_id: value.session_id,
            kind: stored_code(IncidentKind::parse(&value.kind))?,
            message: value.message,
            created_at: value.created_at,
            recovered_at: value.recovered_at,
        })
    }
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = incident_notification, treat_none_as_null = true)]
struct NotificationRow {
    incident_id: String,
    phase: String,
    body: String,
    next_attempt_at: i64,
    event_id: Option<String>,
}

impl TryFrom<NotificationRow> for Notification {
    type Error = Failure;
    fn try_from(value: NotificationRow) -> Result<Self> {
        Ok(Self {
            incident_id: value.incident_id,
            phase: stored_code(NotificationPhase::parse(&value.phase))?,
            body: value.body,
            next_attempt_at: value.next_attempt_at,
            event_id: value.event_id,
        })
    }
}

impl From<&Notification> for NotificationRow {
    fn from(value: &Notification) -> Self {
        Self {
            incident_id: value.incident_id.clone(),
            phase: value.phase.code().to_owned(),
            body: value.body.clone(),
            next_attempt_at: value.next_attempt_at,
            event_id: value.event_id.clone(),
        }
    }
}

impl IncidentRepository for Store {
    fn incident(&mut self, id: &str) -> Result<Option<Incident>> {
        runtime_incident::table
            .filter(runtime_incident::id.eq(id))
            .select(IncidentRow::as_select())
            .first::<IncidentRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Incident::try_from)
            .transpose()
    }
    fn active_incidents(&mut self) -> Result<Vec<Incident>> {
        runtime_incident::table
            .filter(runtime_incident::recovered_at.is_null())
            .select(IncidentRow::as_select())
            .load::<IncidentRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Incident::try_from)
            .collect()
    }
    fn insert_incident(&mut self, value: &Incident) -> Result<()> {
        let row = IncidentRow {
            id: value.id.clone(),
            owner_id: value.owner_id.clone(),
            agent_id: value.agent_id.clone(),
            fleet_id: value.fleet_id.clone(),
            run_id: value.run_id.clone(),
            session_id: value.session_id.clone(),
            kind: value.kind.code().to_owned(),
            message: value.message.clone(),
            created_at: value.created_at,
            recovered_at: value.recovered_at,
        };
        diesel::insert_into(runtime_incident::table)
            .values(row)
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn recover_incident(&mut self, id: &str, now: i64) -> Result<()> {
        diesel::update(runtime_incident::table.filter(runtime_incident::id.eq(id)))
            .set(runtime_incident::recovered_at.eq(now))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn notifications(&mut self, now: i64) -> Result<Vec<Notification>> {
        incident_notification::table
            .filter(
                incident_notification::event_id
                    .is_null()
                    .and(incident_notification::next_attempt_at.le(now)),
            )
            .order((
                incident_notification::next_attempt_at.asc(),
                incident_notification::phase.asc(),
            ))
            .limit(100)
            .select(NotificationRow::as_select())
            .load::<NotificationRow>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(Notification::try_from)
            .collect()
    }
    fn notification(&mut self, id: &str, phase: NotificationPhase) -> Result<Option<Notification>> {
        incident_notification::table
            .filter(
                incident_notification::incident_id
                    .eq(id)
                    .and(incident_notification::phase.eq(phase.code())),
            )
            .select(NotificationRow::as_select())
            .first::<NotificationRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Notification::try_from)
            .transpose()
    }
    fn insert_notification(&mut self, value: &Notification) -> Result<()> {
        diesel::insert_into(incident_notification::table)
            .values(NotificationRow::from(value))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn save_notification(&mut self, value: &Notification) -> Result<()> {
        diesel::update(
            incident_notification::table.filter(
                incident_notification::incident_id
                    .eq(&value.incident_id)
                    .and(incident_notification::phase.eq(value.phase.code())),
            ),
        )
        .set(NotificationRow::from(value))
        .execute(self.database.connection())
        .map_err(failure)?;
        Ok(())
    }
    fn management_conversation(&mut self, id: &str) -> Result<Option<ManagementConversation>> {
        let row: Option<(String, String, i64)> = management_conversation::table
            .filter(management_conversation::owner_id.eq(id))
            .first(self.database.connection())
            .optional()
            .map_err(failure)?;
        Ok(
            row.map(|(owner_id, room_id, created_at)| ManagementConversation {
                owner_id,
                room_id,
                created_at,
            }),
        )
    }
    fn management_conversation_by_room(
        &mut self,
        room: &str,
    ) -> Result<Option<ManagementConversation>> {
        let row: Option<(String, String, i64)> = management_conversation::table
            .filter(management_conversation::room_id.eq(room))
            .first(self.database.connection())
            .optional()
            .map_err(failure)?;
        Ok(
            row.map(|(owner_id, room_id, created_at)| ManagementConversation {
                owner_id,
                room_id,
                created_at,
            }),
        )
    }
    fn insert_management_conversation(&mut self, value: &ManagementConversation) -> Result<()> {
        diesel::insert_into(management_conversation::table)
            .values((
                management_conversation::owner_id.eq(&value.owner_id),
                management_conversation::room_id.eq(&value.room_id),
                management_conversation::created_at.eq(value.created_at),
            ))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn latest_listener_runs(&mut self) -> Result<Vec<Run>> {
        let later = diesel::alias!(listener_run as later);
        let superseded = later.filter(
            later
                .field(listener_run::agent_id)
                .eq(listener_run::agent_id)
                .and(
                    later
                        .field(listener_run::started_at)
                        .gt(listener_run::started_at)
                        .or(later
                            .field(listener_run::started_at)
                            .eq(listener_run::started_at)
                            .and(later.field(listener_run::id).gt(listener_run::id))),
                ),
        );
        let rows = listener_run::table
            .filter(not(exists(superseded)))
            .select(ListenerRow::as_select())
            .load::<ListenerRow>(self.database.connection())
            .map_err(failure)?;
        Ok(rows.into_iter().map(Run::from).collect())
    }
    fn watched_fleets(&mut self) -> Result<Vec<(Fleet, Connection)>> {
        fleet_connection::table
            .inner_join(fleet::table.on(fleet::id.eq(fleet_connection::fleet_id)))
            .select((FleetRow::as_select(), ConnectionRow::as_select()))
            .load::<(FleetRow, ConnectionRow)>(self.database.connection())
            .map_err(failure)?
            .into_iter()
            .map(|(fleet, connection)| Ok((fleet.try_into()?, connection.into())))
            .collect()
    }
}
