use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;

pub use super::tables::{APPLICATION_ID, SCHEMA_VERSION};

diesel::table! { sqlite_schema (name) { name -> Text, #[sql_name = "type"] kind -> Text, } }
diesel::table! { knex_migrations (name) { name -> Text, } }
diesel::table! { pragma_application_id (application_id) { application_id -> BigInt, } }
diesel::table! { pragma_user_version (user_version) { user_version -> BigInt, } }
diesel::table! { pragma_integrity_check (integrity_check) { integrity_check -> Text, } }
diesel::table! { pragma_foreign_key_check (parent) { parent -> Text, } }

pub fn pragma(connection: &mut SqliteConnection, name: &str) -> Result<i64> {
    let result = match name {
        "application_id" => pragma_application_id::table
            .select(pragma_application_id::application_id)
            .get_result(connection),
        "user_version" => pragma_user_version::table
            .select(pragma_user_version::user_version)
            .get_result(connection),
        "table_count" => sqlite_schema::table
            .filter(sqlite_schema::kind.eq("table"))
            .filter(sqlite_schema::name.not_like("sqlite_%"))
            .count()
            .get_result(connection),
        _ => {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Unsupported storage metadata",
            ));
        }
    };
    result.map_err(super::error::failure)
}

pub fn verify(connection: &mut SqliteConnection) -> Result<()> {
    let application = pragma(connection, "application_id")?;
    let version = pragma(connection, "user_version")?;
    if application == APPLICATION_ID && version == SCHEMA_VERSION {
        let applied = knex_migrations::table
            .select(knex_migrations::name)
            .order(knex_migrations::name)
            .load::<String>(connection)
            .map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Database is not prepared through the shared Knex migrations",
                )
            })?;
        if applied
            .iter()
            .map(String::as_str)
            .eq(super::tables::MIGRATIONS.iter().copied())
        {
            return Ok(());
        }
    }
    Err(Failure::new(
        ErrorCode::Unavailable,
        "Database schema is not current; run the shared Knex migrations before starting Crossfire. No data was changed",
    ))
}

pub fn valid(connection: &mut SqliteConnection) -> Result<bool> {
    let checks = pragma_integrity_check::table
        .select(pragma_integrity_check::integrity_check)
        .load::<String>(connection)
        .map_err(super::error::failure)?;
    let violations: i64 = pragma_foreign_key_check::table
        .count()
        .get_result(connection)
        .map_err(super::error::failure)?;
    Ok(checks == ["ok"] && violations == 0)
}
