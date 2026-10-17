use super::store::Store;
use crate::{
    error::failure,
    tables::{fleet, fleet_connection, fleet_credential, fleet_instance},
};
use crossfire_domain::{
    fleet::values::{Connection, Credential, Fleet, Instance},
    port::FleetRepository,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = fleet, treat_none_as_null = true)]
pub(crate) struct FleetRow {
    archived_at: Option<i64>,
    id: String,
    delivery_enabled: i64,
    label: String,
    controller_name: String,
    revision: i64,
    updated_at: i64,
    owner_id: String,
    fleet_key: String,
    created_at: i64,
}

fn fleet_row(value: &Fleet) -> FleetRow {
    FleetRow {
        archived_at: value.archived_at,
        id: value.id.clone(),
        delivery_enabled: i64::from(value.delivery_enabled),
        label: value.label.clone(),
        controller_name: value.controller_name.clone(),
        revision: value.revision,
        updated_at: value.updated_at,
        owner_id: value.owner_id.clone(),
        fleet_key: value.fleet_key.clone(),
        created_at: value.created_at,
    }
}

#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = fleet_connection, treat_none_as_null = true)]
pub(crate) struct ConnectionRow {
    fleet_id: String,
    connection_id: String,
    credential_id: String,
    last_seen_at: i64,
    expires_at: i64,
    closed_at: Option<i64>,
}

impl FleetRepository for Store {
    fn fleet_instance(
        &mut self,
        owner: &str,
        fleet: &str,
        instance: &str,
    ) -> Result<Option<Instance>> {
        Ok(fleet_instance::table
            .filter(
                fleet_instance::owner_id
                    .eq(owner)
                    .and(fleet_instance::fleet_key.eq(fleet))
                    .and(fleet_instance::instance_key.eq(instance)),
            )
            .select(InstanceRow::as_select())
            .first::<InstanceRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Instance::from))
    }
    fn fleet_instance_by_agent(&mut self, agent: &str) -> Result<Option<Instance>> {
        Ok(fleet_instance::table
            .filter(fleet_instance::agent_id.eq(agent))
            .select(InstanceRow::as_select())
            .first::<InstanceRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Instance::from))
    }
    fn save_fleet_instance(&mut self, value: &Instance) -> Result<()> {
        let count = diesel::update(
            fleet_instance::table.filter(
                fleet_instance::owner_id
                    .eq(&value.owner_id)
                    .and(fleet_instance::fleet_key.eq(&value.fleet_key))
                    .and(fleet_instance::instance_key.eq(&value.instance_key))
                    .and(fleet_instance::agent_id.eq(&value.agent_id)),
            ),
        )
        .set(fleet_instance::retired_at.eq(value.retired_at))
        .execute(self.database.connection())
        .map_err(failure)?;
        if count == 1 {
            Ok(())
        } else {
            Err(Failure::new(
                ErrorCode::Missing,
                "Fleet instance is missing",
            ))
        }
    }
    fn current_fleet_instances(&mut self, value: &Fleet) -> Result<Vec<Instance>> {
        let rows: Vec<(String, String, String, String, Option<i64>)> = fleet_instance::table
            .filter(
                fleet_instance::owner_id
                    .eq(&value.owner_id)
                    .and(fleet_instance::fleet_key.eq(&value.fleet_key))
                    .and(fleet_instance::retired_at.is_null()),
            )
            .order(fleet_instance::instance_key.asc())
            .select((
                fleet_instance::owner_id,
                fleet_instance::fleet_key,
                fleet_instance::instance_key,
                fleet_instance::agent_id,
                fleet_instance::retired_at,
            ))
            .load(self.database.connection())
            .map_err(failure)?;
        Ok(rows
            .into_iter()
            .map(
                |(owner_id, fleet_key, instance_key, agent_id, retired_at)| Instance {
                    owner_id,
                    fleet_key,
                    instance_key,
                    agent_id,
                    retired_at,
                },
            )
            .collect())
    }
    fn fleet_by_key(&mut self, owner_id: &str, key: &str) -> Result<Option<Fleet>> {
        fleet::table
            .filter(fleet::owner_id.eq(owner_id).and(fleet::fleet_key.eq(key)))
            .select(FleetRow::as_select())
            .first::<FleetRow>(self.database.connection())
            .optional()
            .map_err(failure)?
            .map(Fleet::try_from)
            .transpose()
    }
    fn insert_fleet_instance(&mut self, value: &Instance) -> Result<()> {
        diesel::insert_into(fleet_instance::table)
            .values((
                fleet_instance::owner_id.eq(&value.owner_id),
                fleet_instance::fleet_key.eq(&value.fleet_key),
                fleet_instance::instance_key.eq(&value.instance_key),
                fleet_instance::agent_id.eq(&value.agent_id),
                fleet_instance::retired_at.eq(value.retired_at),
            ))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn insert_fleet(&mut self, value: &Fleet) -> Result<()> {
        diesel::insert_into(fleet::table)
            .values(fleet_row(value))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn save_fleet(&mut self, value: &Fleet) -> Result<()> {
        let count = diesel::update(fleet::table.filter(fleet::id.eq(&value.id)))
            .set(fleet_row(value))
            .execute(self.database.connection())
            .map_err(failure)?;
        if count == 1 {
            Ok(())
        } else {
            Err(Failure::new(ErrorCode::Missing, "Fleet not found"))
        }
    }
    fn insert_fleet_credential(&mut self, value: &Credential) -> Result<()> {
        diesel::insert_into(fleet_credential::table)
            .values((
                fleet_credential::id.eq(&value.id),
                fleet_credential::fleet_id.eq(&value.fleet_id),
                fleet_credential::secret_hash.eq(&value.secret_hash),
                fleet_credential::created_at.eq(value.created_at),
                fleet_credential::revoked_at.eq(value.revoked_at),
            ))
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn fleet_connection(&mut self, id: &str) -> Result<Option<Connection>> {
        let row = fleet_connection::table
            .filter(fleet_connection::fleet_id.eq(id))
            .select(ConnectionRow::as_select())
            .first::<ConnectionRow>(self.database.connection())
            .optional()
            .map_err(failure)?;
        Ok(row.map(Connection::from))
    }
    fn save_fleet_connection(&mut self, value: &Connection) -> Result<()> {
        let row = ConnectionRow {
            fleet_id: value.fleet_id.clone(),
            connection_id: value.connection_id.clone(),
            credential_id: value.credential_id.clone(),
            last_seen_at: value.last_seen_at,
            expires_at: value.expires_at,
            closed_at: value.closed_at,
        };
        diesel::insert_into(fleet_connection::table)
            .values(&row)
            .on_conflict(fleet_connection::fleet_id)
            .do_update()
            .set(&row)
            .execute(self.database.connection())
            .map_err(failure)?;
        Ok(())
    }
    fn fleet(&mut self, id: &str) -> Result<Option<Fleet>> {
        let row = fleet::table
            .filter(fleet::id.eq(id))
            .select(FleetRow::as_select())
            .first::<FleetRow>(self.database.connection())
            .optional()
            .map_err(failure)?;
        row.map(Fleet::try_from).transpose()
    }

    fn fleet_credential(&mut self, id: &str) -> Result<Option<Credential>> {
        let row: Option<(String, String, String, i64, Option<i64>)> = fleet_credential::table
            .filter(fleet_credential::id.eq(id))
            .first(self.database.connection())
            .optional()
            .map_err(failure)?;
        Ok(row.map(
            |(id, fleet_id, secret_hash, created_at, revoked_at)| Credential {
                id,
                fleet_id,
                secret_hash,
                created_at,
                revoked_at,
            },
        ))
    }
}
#[derive(Queryable, Selectable)]
#[diesel(table_name=fleet_instance)]
struct InstanceRow {
    retired_at: Option<i64>,
    owner_id: String,
    fleet_key: String,
    instance_key: String,
    agent_id: String,
}
impl From<InstanceRow> for Instance {
    fn from(value: InstanceRow) -> Self {
        Self {
            retired_at: value.retired_at,
            owner_id: value.owner_id,
            fleet_key: value.fleet_key,
            instance_key: value.instance_key,
            agent_id: value.agent_id,
        }
    }
}

impl TryFrom<FleetRow> for Fleet {
    type Error = Failure;
    fn try_from(row: FleetRow) -> Result<Self> {
        let delivery_enabled = match row.delivery_enabled {
            0 => false,
            1 => true,
            _ => {
                return Err(Failure::new(
                    ErrorCode::Unavailable,
                    "Invalid stored fleet delivery state",
                ));
            }
        };
        Ok(Self {
            archived_at: row.archived_at,
            id: row.id,
            delivery_enabled,
            label: row.label,
            controller_name: row.controller_name,
            revision: row.revision,
            updated_at: row.updated_at,
            owner_id: row.owner_id,
            fleet_key: row.fleet_key,
            created_at: row.created_at,
        })
    }
}

impl From<ConnectionRow> for Connection {
    fn from(row: ConnectionRow) -> Self {
        Self {
            fleet_id: row.fleet_id,
            connection_id: row.connection_id,
            credential_id: row.credential_id,
            last_seen_at: row.last_seen_at,
            expires_at: row.expires_at,
            closed_at: row.closed_at,
        }
    }
}
