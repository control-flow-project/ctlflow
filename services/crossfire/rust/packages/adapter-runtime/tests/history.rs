use crossfire_adapter_runtime::history;
use serde_json::json;
use std::{
    fs::OpenOptions,
    io::Write,
    os::unix::fs::{PermissionsExt, symlink},
};

#[test]
fn native_history_reads_only_appended_complete_records()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("rollout.jsonl");
    std::fs::write(&path, b"{\"header\":true}\n{\"old\":true}\n{\"partial\":")?;
    assert_eq!(history::header(&path)?, Some(json!({"header":true})));
    let boundary = history::capture(&path)?.ok_or("Native boundary")?;
    let mut file = OpenOptions::new().append(true).open(&path)?;
    file.write_all("true}\n{\"received\":\"native 😀\"}\n".as_bytes())?;
    let mut records = Vec::new();
    let inspected = history::since(&path, Some(&boundary), |value| {
        records.push(value);
        Ok(())
    })?;
    assert_eq!(
        records,
        [json!({"partial":true}), json!({"received":"native 😀"})]
    );
    assert_eq!(inspected.records, 2);
    assert!(inspected.bytes_read < 100);
    assert!(inspected.maximum_buffered_bytes <= 64 * 1024 + 128);
    Ok(())
}

#[test]
fn changed_replaced_or_untrusted_native_evidence_never_counts_as_a_receipt()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("rollout.jsonl");
    std::fs::write(&path, b"{\"original\":true}\n")?;
    let boundary = history::capture(&path)?.ok_or("Native boundary")?;
    std::fs::write(&path, b"{\"modified\":true}\n")?;
    assert!(
        history::since(&path, Some(&boundary), |_| Ok(())).is_err(),
        "Prefix changed"
    );
    let replacement = directory.path().join("replacement");
    std::fs::write(&replacement, b"{\"original\":true}\n")?;
    std::fs::rename(&replacement, &path)?;
    assert!(
        history::since(&path, Some(&boundary), |_| Ok(())).is_err(),
        "Inode changed"
    );
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o666))?;
    assert!(
        history::capture(&path).is_err(),
        "Shared writer evidence rejected"
    );
    let link = directory.path().join("linked");
    symlink(&path, &link)?;
    assert!(history::header(&link).is_err(), "Symlink file rejected");
    let alias = directory.path().join("alias");
    symlink(directory.path(), &alias)?;
    assert!(
        history::header(&alias.join("rollout.jsonl")).is_err(),
        "Symlink directory rejected"
    );
    let missing = directory.path().join("missing");
    assert_eq!(history::since(&missing, None, |_| Ok(()))?.records, 0);
    assert!(
        history::since(&missing, Some(&boundary), |_| Ok(())).is_err(),
        "Missing retained boundary rejected"
    );
    Ok(())
}

#[test]
fn large_native_records_are_incremental_but_malformed_complete_records_fail()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("rollout.jsonl");
    let text = "x".repeat(3 * 1024 * 1024);
    let bytes = serde_json::to_vec(&json!({"evidence":text}))?;
    let mut file = std::fs::File::create(&path)?;
    file.write_all(&bytes)?;
    file.write_all(b"\n{\"incomplete\":")?;
    let mut count = 0;
    let inspected = history::since(&path, None, |value| {
        assert_eq!(value["evidence"].as_str().map(str::len), Some(text.len()));
        count += 1;
        Ok(())
    })?;
    assert_eq!(count, 1);
    assert!(inspected.maximum_buffered_bytes < 8 * 1024 * 1024);
    std::fs::write(&path, b"{bad}\n")?;
    assert!(history::since(&path, None, |_| Ok(())).is_err());
    Ok(())
}
