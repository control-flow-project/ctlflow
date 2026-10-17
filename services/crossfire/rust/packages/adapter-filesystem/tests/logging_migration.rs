use crossfire_adapter_filesystem::{PrivateDirectory, logging};
use crossfire_domain::logging::DAY_MS;
use std::{
    fs::{File, FileTimes},
    os::unix::fs::PermissionsExt,
    time::{Duration, UNIX_EPOCH},
};

fn temporary() -> Result<tempfile::TempDir, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
    Ok(directory)
}
fn write(
    directory: &PrivateDirectory,
    name: &str,
    bytes: &[u8],
    at: i64,
) -> Result<(), Box<dyn std::error::Error>> {
    directory.write_new(name, bytes)?;
    directory.open_private(name, false)?.set_times(
        FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_millis(at.try_into()?)),
    )?;
    Ok(())
}
#[tokio::test]
async fn explicit_conversion_retains_utf8_across_read_boundaries_and_is_repeatable()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = temporary()?;
    let private = PrivateDirectory::open(directory.path(), false)?;
    let at = 1767225600000;
    let message = "🙂Ω".repeat(30000);
    write(&private, "daemon.log", message.as_bytes(), at)?;
    let destination = directory.path().join("logs");
    logging::migrate(
        &directory.path().join("daemon.log"),
        &destination,
        7,
        at + DAY_MS,
    )
    .await?;
    assert!(private.read_optional("daemon.log", 1048576)?.is_none());
    let logs = PrivateDirectory::open(&destination, false)?;
    let names = logs.names(10)?;
    assert_eq!(names.len(), 1);
    let bytes = logs.read(&names[0], 1048576)?;
    let mut decoded = String::new();
    for line in bytes
        .split(|value| *value == b'\n')
        .filter(|value| !value.is_empty())
    {
        let value: serde_json::Value = serde_json::from_slice(line)?;
        assert_eq!(value["at"], at);
        assert_eq!(value["timeBasis"], "file-modification-upper-bound");
        decoded.push_str(value["message"].as_str().ok_or("Original log content")?);
    }
    assert!(
        decoded == message,
        "Conversion preserves exact Unicode content"
    );
    logging::migrate(
        &directory.path().join("daemon.log"),
        &destination,
        7,
        at + DAY_MS,
    )
    .await?;
    assert_eq!(logs.names(10)?, names);
    Ok(())
}
#[tokio::test]
async fn invalid_conversion_preserves_original_and_expired_input_does_not_create_logs()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = temporary()?;
    let private = PrivateDirectory::open(directory.path(), false)?;
    let at = 1767225600000;
    write(&private, "daemon.log", &[b'a', 0xff], at)?;
    let destination = directory.path().join("logs");
    assert!(
        logging::migrate(&directory.path().join("daemon.log"), &destination, 7, at)
            .await
            .is_err()
    );
    assert_eq!(private.read("daemon.log", 1024)?, [b'a', 0xff]);
    assert!(
        PrivateDirectory::open(&destination, false)?
            .names(10)?
            .is_empty()
    );
    File::open(directory.path().join("daemon.log"))?.set_times(
        FileTimes::new()
            .set_modified(UNIX_EPOCH + Duration::from_millis((at - 8 * DAY_MS).try_into()?)),
    )?;
    logging::migrate(&directory.path().join("daemon.log"), &destination, 7, at).await?;
    assert!(private.read_optional("daemon.log", 1024)?.is_none());
    Ok(())
}
