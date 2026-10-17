use crate::{
    error::failure,
    fleet::{ConnectionRow, FleetRow},
    store::Store,
    tables::{fleet, fleet_connection, fleet_controller_metadata, fleet_instance},
};
use crossfire_domain::{
    fleet::values::{Connection, Fleet},
    identity::Page,
    read::values::{Deployment, Pagination},
};
use crossfire_kernel::Result;
use diesel::prelude::*;
use std::collections::BTreeMap;
pub(super) fn deployments(
    store: &mut Store,
    ids: &[String],
) -> Result<BTreeMap<String, Deployment>> {
    let rows = fleet_instance::table
        .inner_join(
            fleet::table.on(fleet::owner_id
                .eq(fleet_instance::owner_id)
                .and(fleet::fleet_key.eq(fleet_instance::fleet_key))),
        )
        .filter(
            fleet_instance::agent_id
                .eq_any(ids)
                .and(fleet_instance::retired_at.is_null())
                .and(fleet::archived_at.is_null()),
        )
        .select((
            fleet_instance::agent_id,
            fleet::id,
            fleet::fleet_key,
            fleet::label,
            fleet::controller_name,
            fleet::updated_at,
            fleet_instance::instance_key,
        ))
        .load::<(String, String, String, String, String, i64, String)>(store.database.connection())
        .map_err(failure)?;
    Ok(rows
        .into_iter()
        .map(
            |(agent_id, fleet_id, fleet_key, label, controller_name, reported_at, instance_key)| {
                (
                    agent_id.clone(),
                    Deployment {
                        agent_id,
                        fleet_id,
                        fleet_key,
                        label,
                        controller_name,
                        reported_at,
                        instance_key,
                    },
                )
            },
        )
        .collect())
}
pub(super) fn page(
    store: &mut Store,
    owner: Option<&str>,
    search: &str,
    pagination: Pagination,
) -> Result<Page<Fleet>> {
    pagination.validate()?;
    let search = format!("%{search}%");
    let base = fleet::table.filter(fleet::archived_at.is_null()).filter(
        fleet::label
            .like(&search)
            .or(fleet::fleet_key.like(&search))
            .or(fleet::controller_name.like(&search)),
    );
    let mut count = base.into_boxed();
    let mut records = base.into_boxed();
    if let Some(owner) = owner {
        count = count.filter(fleet::owner_id.eq(owner));
        records = records.filter(fleet::owner_id.eq(owner));
    }
    let total = count
        .count()
        .get_result::<i64>(store.database.connection())
        .map_err(failure)?;
    let items = records
        .order((fleet::created_at.desc(), fleet::id.asc()))
        .offset(pagination.offset())
        .limit(pagination.size)
        .select(FleetRow::as_select())
        .load::<FleetRow>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(Fleet::try_from)
        .collect::<Result<Vec<_>>>()?;
    Ok(pagination.finish(items, total))
}
pub(super) fn metadata(
    store: &mut Store,
    ids: &[String],
) -> Result<BTreeMap<String, BTreeMap<String, String>>> {
    let entries = fleet_controller_metadata::table
        .filter(fleet_controller_metadata::fleet_id.eq_any(ids))
        .order((
            fleet_controller_metadata::fleet_id.asc(),
            fleet_controller_metadata::key.asc(),
        ))
        .select((
            fleet_controller_metadata::fleet_id,
            fleet_controller_metadata::key,
            fleet_controller_metadata::value,
        ))
        .load::<(String, String, String)>(store.database.connection())
        .map_err(failure)?;
    let mut result: BTreeMap<String, BTreeMap<String, String>> = BTreeMap::new();
    for (id, key, value) in entries {
        result.entry(id).or_default().insert(key, value);
    }
    Ok(result)
}
pub(super) fn connections(
    store: &mut Store,
    ids: &[String],
) -> Result<BTreeMap<String, Connection>> {
    Ok(fleet_connection::table
        .filter(fleet_connection::fleet_id.eq_any(ids))
        .select(ConnectionRow::as_select())
        .load::<ConnectionRow>(store.database.connection())
        .map_err(failure)?
        .into_iter()
        .map(|row| {
            let connection = Connection::from(row);
            (connection.fleet_id.clone(), connection)
        })
        .collect())
}
