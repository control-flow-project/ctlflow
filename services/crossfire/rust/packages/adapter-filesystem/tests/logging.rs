use crossfire_adapter_filesystem::{PrivateDirectory, logging::Store};
use crossfire_domain::logging::DAY_MS;
use std::os::unix::fs::{PermissionsExt, symlink};

fn temporary() -> Result<tempfile::TempDir, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
    Ok(directory)
}
#[test]
fn logs_preserve_unicode_in_bounded_records_and_stop_after_close()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = temporary()?;
    let store = Store::new(directory.path(), 7)?;
    let message = "Ω🙂\n\0".repeat(40000);
    store.write(1767225600000, &message)?;
    let file = PrivateDirectory::open(directory.path(), false)?
        .read("2026-01-01.jsonl", 4 * 1024 * 1024)?;
    let mut decoded = String::new();
    for line in file
        .split(|value| *value == b'\n')
        .filter(|value| !value.is_empty())
    {
        assert!(line.len() <= 512 * 1024);
        let record: serde_json::Value = serde_json::from_slice(line)?;
        assert_eq!(record["at"].as_i64(), Some(1767225600000));
        decoded.push_str(record["message"].as_str().ok_or("missing message")?);
    }
    assert!(
        decoded == message,
        "bounded UTF-8 records must reconstruct the entire message exactly"
    );
    assert_eq!(store.error()?, None);
    store.close();
    assert!(store.write(1767225600000, "closed").is_err());
    assert!(store.error()?.is_some());
    Ok(())
}
#[test]
fn retention_removes_old_records_but_keeps_exact_cutoff_and_unrelated_inputs()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = temporary()?;
    let state = PrivateDirectory::open(directory.path(), false)?;
    state.write_new("authored.txt", b"not a diagnostic record")?;
    let store = Store::new(directory.path(), 7)?;
    let day = 1767225600000;
    store.write(day - DAY_MS, "old partition")?;
    store.write(day + 99, "expired record")?;
    store.write(day + 100, "exact cutoff")?;
    store.write(day + DAY_MS, "newer record")?;
    store.maintain(day + 7 * DAY_MS + 100)?;
    assert!(state.read_optional("2025-12-31.jsonl", 4096)?.is_none());
    let retained = String::from_utf8(state.read("2026-01-01.jsonl", 4096)?)?;
    assert!(!retained.contains("expired record"));
    assert!(retained.contains("exact cutoff"));
    assert!(state.read_optional("2026-01-02.jsonl", 4096)?.is_some());
    assert_eq!(
        state.read("authored.txt", 4096)?,
        b"not a diagnostic record"
    );
    assert!(
        !state
            .names(100)?
            .iter()
            .any(|name| name.contains("pending"))
    );
    assert_eq!(store.error()?, None);
    Ok(())
}
#[test]
fn unsafe_or_incomplete_diagnostics_are_retained_with_a_visible_error()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = temporary()?;
    let state = PrivateDirectory::open(directory.path(), false)?;
    state.write_new("2026-01-01.jsonl", b"{\"at\":1767225600000}")?;
    let store = Store::new(directory.path(), 7)?;
    assert!(store.maintain(1767225600000 + 7 * DAY_MS + 1).is_err());
    assert!(store.error()?.is_some());
    assert_eq!(
        state.read("2026-01-01.jsonl", 4096)?,
        b"{\"at\":1767225600000}"
    );
    state.remove("2026-01-01.jsonl")?;
    state.write_new("authored", b"preserve")?;
    symlink(
        directory.path().join("authored"),
        directory.path().join("2025-12-31.jsonl"),
    )?;
    assert!(store.maintain(1767225600000 + 7 * DAY_MS + 1).is_err());
    assert_eq!(state.read("authored", 4096)?, b"preserve");
    Ok(())
}

#[test]
fn invalid_owned_partitions_are_visible_but_do_not_prevent_other_expired_logs_from_rotating()
-> Result<(), Box<dyn std::error::Error>> {
    let directory = temporary()?;
    let state = PrivateDirectory::open(directory.path(), false)?;
    state.write_new("2026-13-01.jsonl", b"invalid date\n")?;
    let store = Store::new(directory.path(), 7)?;
    let now = 1767225600000;
    store.write(now - 10 * DAY_MS, "expired")?;
    assert!(store.maintain(now).is_err());
    assert!(store.error()?.is_some());
    assert!(state.read_optional("2025-12-22.jsonl", 4096)?.is_none());
    assert!(state.read_optional("2026-13-01.jsonl", 4096)?.is_some());
    Ok(())
}
