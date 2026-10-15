use crate::{error::failure, schema, tables};
use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use diesel::{
    prelude::*,
    sql_types::{BigInt, Text},
};
use std::{
    fs::File,
    path::{Path, PathBuf},
};

#[derive(QueryableByName)]
struct Number {
    #[diesel(sql_type=BigInt)]
    value: i64,
}
#[derive(QueryableByName)]
struct Check {
    #[diesel(sql_type=Text)]
    integrity_check: String,
}
#[derive(QueryableByName)]
struct ForeignKey {
    #[diesel(sql_type=Text, column_name=table)]
    _table: String,
}
fn invalid() -> Failure {
    Failure::new(
        ErrorCode::Conflict,
        "Unsupported or invalid management database; migration is blocked and no data was changed",
    )
}
fn number(connection: &mut SqliteConnection, sql: &str) -> Result<i64> {
    diesel::sql_query(sql)
        .get_result::<Number>(connection)
        .map(|row| row.value)
        .map_err(failure)
}
fn open(path: &Path) -> Result<SqliteConnection> {
    let parent = PrivateDirectory::open(path.parent().ok_or_else(invalid)?, false)?;
    parent.prepared_database(
        path.file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(invalid)?,
    )?;
    let mut uri = url::Url::from_file_path(path).map_err(|_| invalid())?;
    uri.query_pairs_mut().append_pair("mode", "ro");
    SqliteConnection::establish(uri.as_str()).map_err(|_| invalid())
}
fn verify(connection: &mut SqliteConnection) -> Result<()> {
    if schema::pragma(connection, "application_id")? != tables::APPLICATION_ID {
        return Err(invalid());
    }
    let checks = diesel::sql_query("PRAGMA integrity_check")
        .load::<Check>(connection)
        .map_err(failure)?;
    if checks.len() != 1 || checks[0].integrity_check != "ok" {
        return Err(invalid());
    }
    let violations = diesel::sql_query("PRAGMA foreign_key_check")
        .load::<ForeignKey>(connection)
        .map_err(failure)?;
    if !violations.is_empty() {
        return Err(invalid());
    }
    Ok(())
}
pub fn backup_before_migration(directory: &Path) -> Result<Option<PathBuf>> {
    let private = PrivateDirectory::open(directory, false)?;
    let file = directory.join("management.sqlite");
    match std::fs::symlink_metadata(&file) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(invalid()),
        Ok(_) => {}
    }
    let mut source = open(&file)?;
    let application = schema::pragma(&mut source, "application_id")?;
    let version = schema::pragma(&mut source, "user_version")?;
    if application == 0 && version == 0 {
        let count = number(
            &mut source,
            "SELECT count(*) AS value FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('knex_migrations','knex_migrations_lock')",
        )?;
        if count == 0
            && (number(
                &mut source,
                "SELECT count(*) AS value FROM sqlite_schema WHERE type='table' AND name='knex_migrations'",
            )? == 0
                || number(&mut source, "SELECT count(*) AS value FROM knex_migrations")? == 0)
        {
            return Ok(None);
        }
    }
    if application != tables::APPLICATION_ID || !(13..=tables::SCHEMA_VERSION).contains(&version) {
        return Err(invalid());
    }
    verify(&mut source)?;
    if schema::verify(&mut source).is_ok() {
        return Ok(None);
    }
    let backups = private.child("backups", true)?;
    let name = format!("management-{}.sqlite", identity::id());
    let target = directory.join("backups").join(&name);
    let result = (|| {
        let descriptor: File = backups.open_private(&name, true)?;
        diesel::sql_query("VACUUM main INTO ?")
            .bind::<Text, _>(target.to_str().ok_or_else(invalid)?)
            .execute(&mut source)
            .map_err(failure)?;
        let mut copy = open(&target)?;
        verify(&mut copy)?;
        if schema::pragma(&mut copy, "user_version")? != version {
            return Err(invalid());
        }
        descriptor.sync_all().map_err(|_| invalid())?;
        backups.sync()?;
        Ok(target)
    })();
    match result {
        Ok(target) => Ok(Some(target)),
        Err(error) => {
            backups.remove(&name)?;
            Err(error)
        }
    }
}
