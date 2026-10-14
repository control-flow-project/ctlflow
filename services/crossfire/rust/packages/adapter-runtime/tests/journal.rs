use crossfire_adapter_filesystem::PrivateDirectory;
use crossfire_adapter_runtime::{
    journal::{self, Journal, NativeMessage},
    resumption,
};
use crossfire_kernel::Result;
use serde::{Deserialize, Serialize};
use std::os::unix::fs::PermissionsExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Message {
    text: String,
    message_id: String,
    boundary: Option<u64>,
}
impl NativeMessage for Message {
    fn text(&self) -> &str {
        &self.text
    }
    fn message_id(&self) -> &str {
        &self.message_id
    }
    fn validate(&self) -> Result<()> {
        journal::validate_message(&self.text, &self.message_id)
    }
}
fn message(id: &str, text: &str) -> Message {
    Message {
        text: text.to_owned(),
        message_id: id.to_owned(),
        boundary: None,
    }
}

#[test]
fn durable_journal_owns_exact_identity_and_releases_its_lock()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let file = directory.path().join("input.json");
    let mut journal = Journal::<Message>::open(&file, "session")?;
    assert!(
        Journal::<Message>::open(&file, "session").is_err(),
        "Exclusive state ownership"
    );
    let first = message("request", "native input\n😀");
    journal.prepare(first.clone())?;
    assert_eq!(
        journal::read::<Message>(&file, "session")?
            .pending
            .as_ref()
            .map(|value| value.text.as_str()),
        Some(first.text.as_str())
    );
    assert!(
        journal.prepare(message("other", "another input")).is_err(),
        "Pending identity cannot be replaced"
    );
    assert!(
        journal
            .complete(&message("request", "changed"), true)
            .is_err(),
        "Completion cannot change text"
    );
    let mut with_boundary = first.clone();
    with_boundary.boundary = Some(99);
    journal.prepare(with_boundary)?;
    journal.complete(&first, true)?;
    assert!(journal.confirmed(&first.text, "request")?);
    assert!(
        journal.confirmed("changed", "request").is_err(),
        "Confirmed identity binds its content"
    );
    assert!(
        journal.prepare(first.clone()).is_err(),
        "Confirmed input cannot also be pending"
    );
    journal.close();
    assert!(journal.pending().is_err(), "Closed journal cannot be used");
    let mut restored = Journal::<Message>::open(&file, "session")?;
    assert!(restored.confirmed(&first.text, "request")?);
    restored.acknowledge(&["request".to_owned()])?;
    assert!(!restored.unsettled()?);
    assert!(
        journal::read::<Message>(&file, "another-session").is_err(),
        "Wrong native history cannot adopt evidence"
    );
    Ok(())
}

#[test]
fn malformed_journals_are_rejected_without_repair_or_resubmission()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let private = PrivateDirectory::open(directory.path(), false)?;
    let file = directory.path().join("input.json");
    let digest = journal::digest("body");
    for value in [
        serde_json::json!({"sessionId":"session","confirmed":[]}),
        serde_json::json!({"sessionId":"session","pending":null,"confirmed":[],"extra":true}),
        serde_json::json!({"sessionId":"session","pending":null,"confirmed":[{"messageId":"a","digest":"bad"}]}),
        serde_json::json!({"sessionId":"session","pending":{"text":"body","messageId":"a","boundary":null},"confirmed":[{"messageId":"a","digest":digest}]}),
        serde_json::json!({"sessionId":"session","pending":null,"confirmed":[{"messageId":"a","digest":digest},{"messageId":"a","digest":digest}]}),
    ] {
        let bytes = serde_json::to_vec(&value)?;
        private.write_atomic("input.json", &bytes)?;
        assert!(
            Journal::<Message>::open(&file, "session").is_err(),
            "Malformed journal rejected"
        );
        assert_eq!(
            private.read("input.json", 4096)?,
            bytes,
            "Rejected evidence is preserved"
        );
    }
    assert!(journal::validate_message(&"x".repeat(4 * 1024 * 1024 + 1), "input").is_err());
    assert!(journal::validate_message("body", "bad\nidentity").is_err());
    Ok(())
}

#[test]
fn failed_durable_write_does_not_change_in_memory_evidence()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let file = directory.path().join("input.json");
    let mut journal = Journal::<Message>::open(&file, "session")?;
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o500))?;
    let result = journal.prepare(message("request", "text"));
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
    assert!(result.is_err(), "No durable native input on a failed write");
    assert!(
        journal.pending()?.is_none(),
        "Memory does not invent a saved publication"
    );
    Ok(())
}

#[test]
fn restart_notice_retains_verbatim_attribution_without_exposing_absolute_paths()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::Builder::new()
        .permissions(std::os::unix::fs::PermissionsExt::from_mode(0o700))
        .tempdir()?;
    let input = message(
        "$matrix-event",
        "[room !room:test; from @human:test; 1234]\nContinue the authorized task.",
    );
    let file = directory.path().join("input.json");
    let stored = resumption::retain(&input, &file)?;
    assert_eq!(std::fs::read_to_string(&stored)?, input.text);
    let notice = resumption::text(&input, &file, directory.path())?;
    assert!(notice.contains("Re-read the applicable AGENTS.md"));
    assert!(notice.contains("old execution is not running"));
    assert!(notice.contains("does not answer or approve"));
    assert!(!notice.contains(directory.path().to_str().ok_or("Fixture path")?));
    assert!(notice.contains("resume-input/"));
    std::fs::write(&stored, "changed")?;
    assert!(
        resumption::retain(&input, &file).is_err(),
        "Existing evidence must match exactly"
    );
    Ok(())
}
