use crossfire_adapter_filesystem::local_state::State;
use crossfire_agent_core::{artifacts::Store, chat::Artifacts, events, local_state::LocalState};
use crossfire_domain::messaging_client::{EventType, MessageContent, MessageEvent, MessageKind};
use crossfire_kernel::{Result, time::Clock};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    os::unix::fs::PermissionsExt,
    sync::{
        Arc,
        atomic::{AtomicI64, Ordering},
    },
};

fn temporary() -> std::result::Result<tempfile::TempDir, Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))?;
    Ok(directory)
}

struct Time(Arc<AtomicI64>);
impl Clock for Time {
    fn now(&self) -> Result<i64> {
        Ok(self.0.load(Ordering::SeqCst))
    }
}
#[test]
fn real_private_files_keep_large_messages_out_of_input_and_protect_pending_content()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = temporary()?;
    let storage = Arc::new(State::open(directory.path(), false)?);
    let root = directory.path().join("messages");
    let root = root.to_str().ok_or("root must be UTF-8")?;
    let instant = Arc::new(AtomicI64::new(1));
    let artifacts = Store::open(storage.clone(), root, Time(instant.clone()))?;
    let event = events::view(
        &MessageEvent {
            event_id: "event/large".to_owned(),
            room_id: "room/main".to_owned(),
            sender: "person/human".to_owned(),
            event_type: EventType::Message,
            subject_id: None,
            sent_at: None,
            omitted: None,
            content: MessageContent {
                kind: MessageKind::Text,
                body: Some("é".repeat(70000)),
                mentions: vec![],
                edited: false,
                control: false,
                attachments: vec![],
                attributes: Default::default(),
            },
        },
        "room/main",
    )?;
    let staged = artifacts.stage(vec![event])?;
    assert!(staged[0].content.body.is_none());
    let file = staged[0]
        .content_file
        .as_ref()
        .ok_or("content file required")?;
    assert!(file.source_bytes > 65536);
    let pointer = artifacts.prepare(
        &staged,
        "large".repeat(70000),
        "message-exact",
        65536,
        &json!({"origin":"external"}),
    )?;
    assert!(pointer.len() <= 65536);
    let control: Value = serde_json::from_str(
        pointer
            .split_once('\n')
            .ok_or("pointer metadata required")?
            .1,
    )?;
    let manifest = control["manifest"].as_str().ok_or("manifest required")?;
    assert!(storage.read(manifest, 65536)?.is_some());
    let protected = BTreeSet::from([file.file.clone()]);
    artifacts.release(&["message-exact".to_owned()])?;
    instant.store(86400002, Ordering::SeqCst);
    artifacts.cleanup(false, &protected)?;
    assert!(storage.read(&file.file, 1000000)?.is_some());
    artifacts.stage(staged.clone())?;
    storage.write(&file.file, b"{}", 1000000)?;
    assert!(artifacts.stage(staged).is_err());
    assert!(storage.write("../escape", b"{}", 100).is_err());
    assert!(storage.read("/etc/passwd", 1000000).is_err());
    Ok(())
}
#[test]
fn cleanup_preserves_busy_inputs_and_reclaims_released_files_only_after_retention()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = temporary()?;
    let storage = Arc::new(State::open(directory.path(), false)?);
    let root = directory.path().join("messages");
    let root = root.to_str().ok_or("root must be UTF-8")?;
    let instant = Arc::new(AtomicI64::new(1));
    let store = Store::open(storage.clone(), root, Time(instant.clone()))?;
    let text = store.input(
        "input".repeat(30000),
        "config-input",
        4096,
        &json!({"source":"configured"}),
    )?;
    let value: Value = serde_json::from_str(text.split_once('\n').ok_or("pointer required")?.1)?;
    let file = value["file"].as_str().ok_or("file required")?;
    store.release(&["config-input".to_owned()])?;
    instant.store(86400002, Ordering::SeqCst);
    store.cleanup(true, &BTreeSet::new())?;
    assert!(storage.read(file, 1000000)?.is_some());
    store.cleanup(false, &BTreeSet::new())?;
    assert!(storage.read(file, 1000000)?.is_none());
    Ok(())
}
