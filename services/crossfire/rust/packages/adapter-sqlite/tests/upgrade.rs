use crossfire_adapter_sqlite::{schema, upgrade::backup_before_migration};
use crossfire_test_support::sqlite::PreparedDatabase;
use diesel::{connection::SimpleConnection, prelude::*};

#[test]
fn only_shared_knex_migrates_and_a_verified_snapshot_precedes_an_upgrade()
-> Result<(), Box<dyn std::error::Error>> {
    let prepared = PreparedDatabase::copy()?;
    let directory = prepared.path().parent().ok_or("Database directory")?;
    assert!(backup_before_migration(directory)?.is_none());
    let mut original =
        SqliteConnection::establish(prepared.path().to_str().ok_or("Database filename")?)?;
    original.batch_execute("PRAGMA user_version=16")?;
    let before = std::fs::read(prepared.path())?;
    let backup = backup_before_migration(directory)?.ok_or("Verified backup")?;
    assert_eq!(
        std::fs::read(prepared.path())?,
        before,
        "Backup never changes a source or its migration metadata"
    );
    let mut checked = SqliteConnection::establish(backup.to_str().ok_or("Backup filename")?)?;
    assert_eq!(schema::pragma(&mut checked, "user_version")?, 16);
    assert_eq!(
        schema::pragma(&mut checked, "application_id")?,
        schema::APPLICATION_ID
    );
    assert_eq!(
        schema::pragma(&mut checked, "table_count")?,
        schema::pragma(&mut original, "table_count")?
    );
    original.batch_execute("PRAGMA user_version=18")?;
    let future = std::fs::read(prepared.path())?;
    assert!(backup_before_migration(directory).is_err());
    assert_eq!(std::fs::read(prepared.path())?, future);
    assert_eq!(
        std::fs::read_dir(directory.join("backups"))?.count(),
        1,
        "Unsupported schemas do not produce misleading backups"
    );
    Ok(())
}
