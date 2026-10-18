use crossfire_adapter_sqlite::{config::DatabaseConfig, db::Database};
use crossfire_test_support::sqlite::PreparedDatabase;
use diesel::{connection::SimpleConnection, prelude::*};
use std::{fs, os::unix::fs::PermissionsExt};

#[test]
fn opening_never_creates_storage_or_changes_unsupported_schema()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))?;
    let path = directory.path().join("missing.sqlite");
    assert!(
        Database::open(&DatabaseConfig::Sqlite {
            filename: path.clone()
        })
        .is_err()
    );
    assert!(!path.exists());
    let prepared = PreparedDatabase::copy()?;
    {
        let mut connection =
            SqliteConnection::establish(prepared.path().to_str().ok_or("Invalid fixture path")?)?;
        connection.batch_execute("PRAGMA user_version=16")?;
    }
    let before = fs::read(prepared.path())?;
    assert!(
        Database::open(&DatabaseConfig::Sqlite {
            filename: prepared.path().to_owned()
        })
        .is_err()
    );
    assert_eq!(fs::read(prepared.path())?, before);
    Ok(())
}

#[test]
fn completed_knex_metadata_is_mandatory_and_never_repaired_at_startup()
-> Result<(), Box<dyn std::error::Error>> {
    let prepared = PreparedDatabase::copy()?;
    let changed = std::process::Command::new("node")
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .args([
            "--input-type=module",
            "-e",
            "import knex from 'knex'; const connection = knex({client: 'better-sqlite3', useNullAsDefault: true, connection: {filename: process.argv[1]}}); try { await connection.schema.dropTable('knex_migrations'); } finally { await connection.destroy(); }",
        ])
        .arg(prepared.path())
        .status()?;
    assert!(
        changed.success(),
        "Knex must prepare its missing-metadata fixture"
    );
    let before = fs::read(prepared.path())?;
    assert!(
        Database::open(&DatabaseConfig::Sqlite {
            filename: prepared.path().to_owned()
        })
        .is_err()
    );
    assert_eq!(fs::read(prepared.path())?, before);
    Ok(())
}
