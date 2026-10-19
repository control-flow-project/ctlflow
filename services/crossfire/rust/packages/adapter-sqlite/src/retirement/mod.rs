mod snapshot;
use crate::{
    error::failure,
    listener::ListenerRow,
    store::Store,
    tables::{fleet_credential, fleet_native_stop as proof, listener_run as run},
};
use crossfire_domain::{
    fleet::native_stop::{
        NativeStop, NativeStopRepository, RetirementRepository, Selection, Snapshot,
    },
    listener::Run,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;
#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name=proof)]
pub(super) struct Row {
    pub agent_id: String,
    pub receipt_id: String,
    pub sequence: i64,
    pub fleet_id: String,
    pub run_id: String,
    pub connection_id: String,
    pub credential_id: String,
    pub native_stopped_at: i64,
    pub invalidated_at: Option<i64>,
}
impl From<Row> for NativeStop {
    fn from(value: Row) -> Self {
        Self {
            agent_id: value.agent_id,
            receipt_id: value.receipt_id,
            sequence: value.sequence,
            fleet_id: value.fleet_id,
            run_id: value.run_id,
            connection_id: value.connection_id,
            credential_id: value.credential_id,
            native_stopped_at: value.native_stopped_at,
            invalidated_at: value.invalidated_at,
        }
    }
}
impl From<&NativeStop> for Row {
    fn from(value: &NativeStop) -> Self {
        Self {
            agent_id: value.agent_id.clone(),
            receipt_id: value.receipt_id.clone(),
            sequence: value.sequence,
            fleet_id: value.fleet_id.clone(),
            run_id: value.run_id.clone(),
            connection_id: value.connection_id.clone(),
            credential_id: value.credential_id.clone(),
            native_stopped_at: value.native_stopped_at,
            invalidated_at: value.invalidated_at,
        }
    }
}
impl NativeStopRepository for Store {
    fn native_stop(&mut self, id: &str) -> Result<Option<NativeStop>> {
        Ok(proof::table
            .filter(proof::agent_id.eq(id))
            .order(proof::sequence.desc())
            .select(Row::as_select())
            .first::<Row>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(NativeStop::from))
    }
    fn native_stop_receipt(&mut self, id: &str, receipt: &str) -> Result<Option<NativeStop>> {
        Ok(proof::table
            .filter(proof::agent_id.eq(id).and(proof::receipt_id.eq(receipt)))
            .select(Row::as_select())
            .first::<Row>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(NativeStop::from))
    }
    fn insert_native_stop(&mut self, value: &NativeStop) -> Result<()> {
        diesel::insert_into(proof::table)
            .values(Row::from(value))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn invalidate_native_stop(&mut self, id: &str, now: i64) -> Result<()> {
        diesel::update(
            proof::table.filter(proof::agent_id.eq(id).and(proof::invalidated_at.is_null())),
        )
        .set(proof::invalidated_at.eq(now))
        .execute(self.database.connection())
        .map_err(failure)?;
        Ok(())
    }
}
impl RetirementRepository for Store {
    fn retirement(&mut self, selection: Selection<'_>, now: i64) -> Result<Snapshot> {
        snapshot::read(self, selection, now)
    }
    fn latest_listener(&mut self, id: &str) -> Result<Option<Run>> {
        let row = run::table
            .filter(run::agent_id.eq(id))
            .order((run::started_at.desc(), run::id.desc()))
            .select(ListenerRow::as_select())
            .first::<ListenerRow>(self.database.connection())
            .optional()
            .map_err(failure)?;
        Ok(row.map(Run::from))
    }
    fn retire_listener_runs(&mut self, id: &str, now: i64) -> Result<()> {
        diesel::update(
            run::table.filter(
                run::agent_id
                    .eq(id)
                    .and(run::stopped_at.is_null())
                    .and(run::disconnect_requested_at.is_null()),
            ),
        )
        .set(run::disconnect_requested_at.eq(now))
        .execute(self.database.connection())
        .map_err(failure)?;
        Ok(())
    }
    fn revoke_fleet_credentials(&mut self, id: &str, now: i64) -> Result<()> {
        diesel::update(
            fleet_credential::table.filter(
                fleet_credential::fleet_id
                    .eq(id)
                    .and(fleet_credential::revoked_at.is_null()),
            ),
        )
        .set(fleet_credential::revoked_at.eq(now))
        .execute(self.database.connection())
        .map_err(failure)?;
        Ok(())
    }
}
pub(super) fn validate_selection(selection: &Selection<'_>) -> Result<()> {
    let values = match selection {
        Selection::Agents(values) | Selection::Fleets(values) => values,
    };
    if values.len() > 10000
        || values
            .iter()
            .any(|value| value.is_empty() || value.len() > 255)
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid retirement selection",
        ));
    }
    Ok(())
}
