use crate::{
    error::failure,
    expression::sum_integer,
    fleet::{ConnectionRow, FleetRow},
    listener::ListenerRow,
    rows,
    store::Store,
    tables::{fleet, fleet_connection, fleet_credential, fleet_instance, listener_run, principal},
};
use crossfire_domain::{
    fleet::values::{Connection, Credential, Fleet},
    identity::Page,
    listener::{AdmissionFacts, Binding, Run},
    read::values::{AdmissionCandidate, ListenerTotal, Pagination},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::{dsl::max, prelude::*};
pub(super) fn totals(store: &mut Store, ids: &[String]) -> Result<Vec<ListenerTotal>> {
    let rows = listener_run::table
        .filter(listener_run::agent_id.eq_any(ids))
        .group_by(listener_run::agent_id)
        .select((
            listener_run::agent_id,
            sum_integer(listener_run::active_ms),
            sum_integer(listener_run::messages_delivered),
            max(listener_run::last_seen_at),
        ))
        .load::<(String, Option<i64>, Option<i64>, Option<i64>)>(store.database.connection())
        .map_err(failure)?;
    rows.into_iter()
        .map(|(agent_id, active_ms, messages_delivered, last_seen_at)| {
            Ok(ListenerTotal {
                agent_id,
                active_ms: active_ms.ok_or_else(|| {
                    Failure::new(ErrorCode::Unavailable, "Invalid listener total")
                })?,
                messages_delivered: messages_delivered.ok_or_else(|| {
                    Failure::new(ErrorCode::Unavailable, "Invalid listener total")
                })?,
                last_seen_at: last_seen_at.ok_or_else(|| {
                    Failure::new(ErrorCode::Unavailable, "Invalid listener total")
                })?,
            })
        })
        .collect()
}
pub(super) fn history(store: &mut Store, agent: &str, pagination: Pagination) -> Result<Page<Run>> {
    pagination.validate()?;
    let total = listener_run::table
        .filter(listener_run::agent_id.eq(agent))
        .count()
        .get_result::<i64>(store.database.connection())
        .map_err(failure)?;
    let items = listener_run::table
        .filter(listener_run::agent_id.eq(agent))
        .order((listener_run::started_at.desc(), listener_run::id.desc()))
        .offset(pagination.offset())
        .limit(pagination.size)
        .select(ListenerRow::as_select())
        .load::<ListenerRow>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(Run::try_from)
        .collect::<Result<Vec<_>>>()?;
    Ok(pagination.finish(items, total))
}
pub(super) fn candidates(
    store: &mut Store,
    ids: Option<&[String]>,
    since: i64,
) -> Result<Vec<AdmissionCandidate>> {
    if ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(Vec::new());
    }
    let mut query = listener_run::table
        .inner_join(fleet_instance::table.on(fleet_instance::agent_id.eq(listener_run::agent_id)))
        .inner_join(fleet::table.on(fleet::id.nullable().eq(listener_run::controller_fleet_id)))
        .inner_join(principal::table.on(principal::id.eq(fleet::owner_id)))
        .inner_join(
            fleet_connection::table.on(fleet_connection::fleet_id
                .nullable()
                .eq(listener_run::controller_fleet_id)),
        )
        .inner_join(
            fleet_credential::table.on(fleet_credential::id
                .nullable()
                .eq(listener_run::controller_credential_id)),
        )
        .filter(
            listener_run::stopped_at
                .is_null()
                .and(listener_run::last_seen_at.gt(since)),
        )
        .into_boxed();
    if let Some(ids) = ids {
        query = query.filter(listener_run::agent_id.eq_any(ids));
    }
    let values = query
        .order((
            listener_run::agent_id.asc(),
            listener_run::last_seen_at.desc(),
            listener_run::id.asc(),
        ))
        .select((
            ListenerRow::as_select(),
            FleetRow::as_select(),
            ConnectionRow::as_select(),
            (
                fleet_credential::id,
                fleet_credential::fleet_id,
                fleet_credential::secret_hash,
                fleet_credential::created_at,
                fleet_credential::revoked_at,
            ),
            (
                fleet_instance::owner_id,
                fleet_instance::fleet_key,
                fleet_instance::retired_at,
            ),
            principal::status,
        ))
        .load::<(
            ListenerRow,
            FleetRow,
            ConnectionRow,
            (String, String, String, i64, Option<i64>),
            (String, String, Option<i64>),
            String,
        )>(store.database.connection())
        .map_err(failure)?;
    values
        .into_iter()
        .map(
            |(
                run,
                fleet,
                connection,
                (id, fleet_id, secret_hash, created_at, revoked_at),
                (owner_id, fleet_key, retired_at),
                status,
            )| {
                Ok(AdmissionCandidate {
                    run: Run::try_from(run)?,
                    facts: Some(AdmissionFacts {
                        binding: Binding {
                            owner_id,
                            fleet_key,
                            retired_at,
                        },
                        fleet: Fleet::try_from(fleet)?,
                        connection: Connection::from(connection),
                        credential: Credential {
                            id,
                            fleet_id,
                            secret_hash,
                            created_at,
                            revoked_at,
                        },
                        owner_status: rows::status(&status)?,
                    }),
                })
            },
        )
        .collect()
}
