use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;

pub use super::tables::{APPLICATION_ID, SCHEMA_VERSION};

#[derive(diesel::QueryableByName)]
struct Integer {
    #[diesel(sql_type = diesel::sql_types::BigInt)]
    value: i64,
}

#[derive(diesel::QueryableByName)]
struct Migration {
    #[diesel(sql_type = diesel::sql_types::Text)]
    name: String,
}

pub fn pragma(connection: &mut SqliteConnection, name: &str) -> Result<i64> {
    let statement = match name {
        "application_id" => "SELECT application_id AS value FROM pragma_application_id",
        "user_version" => "SELECT user_version AS value FROM pragma_user_version",
        "table_count" => {
            "SELECT count(*) AS value FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        }
        _ => {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Unsupported storage metadata",
            ));
        }
    };
    diesel::sql_query(statement)
        .get_result::<Integer>(connection)
        .map(|row| row.value)
        .map_err(super::error::failure)
}

pub fn verify(connection: &mut SqliteConnection) -> Result<()> {
    let application = pragma(connection, "application_id")?;
    let version = pragma(connection, "user_version")?;
    if application == APPLICATION_ID && version == SCHEMA_VERSION {
        let applied = diesel::sql_query("SELECT name FROM knex_migrations ORDER BY name")
            .load::<Migration>(connection)
            .map_err(|_| {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Database is not prepared through the shared Knex migrations",
                )
            })?;
        if applied
            .iter()
            .map(|migration| migration.name.as_str())
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
