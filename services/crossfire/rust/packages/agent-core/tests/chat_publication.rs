mod support;
use crossfire_agent_core::{
    chat_publication::Publication,
    events,
    profile::Settings,
    receive_state::Batch,
    runtime::{Admission, Approval, Connection, InputPriority},
};
use crossfire_domain::{
    identity::PrincipalKind, read::values::PrincipalIdentity, runtime::values::HistoryMode,
};
use crossfire_kernel::Result;
use serde_json::json;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
#[path = "support/artifacts.rs"]
mod artifacts;
use artifacts::Inline;
use support::{Memory, failure};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct NativeState {
    deliveries: Mutex<Vec<(String, String)>>,
    uncertain: AtomicBool,
    acknowledged: Mutex<Vec<String>>,
}
struct Native {
    session: String,
    state: Arc<NativeState>,
}
impl Connection for Native {
    fn session_id(&self) -> &str {
        &self.session
    }
    fn approval(&self) -> Approval {
        Approval::None
    }
    fn lifetime(&self) -> CancellationToken {
        CancellationToken::new()
    }
    async fn inspect(&self) -> Result<bool> {
        Ok(false)
    }
    async fn deliver(
        &self,
        text: &str,
        message: &str,
        _stop: CancellationToken,
        _priority: Option<InputPriority>,
    ) -> Result<()> {
        self.state
            .deliveries
            .lock()
            .map_err(|_| failure())?
            .push((message.to_owned(), text.to_owned()));
        if self.state.uncertain.swap(false, Ordering::SeqCst) {
            Err(failure())
        } else {
            Ok(())
        }
    }
    async fn settle(&self, _stop: CancellationToken) -> Result<bool> {
        Ok(false)
    }
    async fn recover(&self, text: &str, message: &str, _stop: CancellationToken) -> Result<bool> {
        Ok(self
            .state
            .deliveries
            .lock()
            .map_err(|_| failure())?
            .iter()
            .any(|(id, received)| id == message && received == text))
    }
    fn acknowledge(&self, messages: &[String]) -> Result<()> {
        self.state
            .acknowledged
            .lock()
            .map_err(|_| failure())?
            .extend_from_slice(messages);
        Ok(())
    }
    async fn conversation(&self, room: &str, _admission: Option<&Admission>) -> Result<Self> {
        Ok(Self {
            session: format!("{}:{room}", self.session),
            state: self.state.clone(),
        })
    }
    async fn close(&self) -> Result<()> {
        Ok(())
    }
}
fn settings() -> Settings {
    Settings {
        instance: "analyst".to_owned(),
        homeserver: "http://localhost:3000".to_owned(),
        server_name: "local".to_owned(),
        owner: "@owner:local".to_owned(),
        max_upload_bytes: 1048576,
    }
}
fn batch(rooms: &[&str]) -> Result<Batch> {
    let events = rooms.iter().enumerate().map(|(index, room)| events::view(&json!({"event_id":format!("$event-{index}"),"sender":"@owner:local","type":"m.room.message","content":{"msgtype":"m.text","body":format!("Request in {room}")}}), room)).collect::<Result<Vec<_>>>()?;
    Ok(Batch {
        cursors: rooms
            .iter()
            .map(|room| ((*room).to_owned(), "end".to_owned()))
            .collect(),
        latest: events
            .iter()
            .map(|event| (event.room_id.clone(), event.event_id.clone()))
            .collect(),
        events,
        more_rooms: Vec::new(),
    })
}
fn identities() -> BTreeMap<String, PrincipalIdentity> {
    BTreeMap::from([(
        "@owner:local".to_owned(),
        PrincipalIdentity {
            matrix_user_id: "@owner:local".to_owned(),
            kind: Some(PrincipalKind::Human),
            owner_matrix_id: None,
            display_name: Some("Owner".to_owned()),
            owner_display_name: None,
        },
    )])
}

#[tokio::test]
async fn restart_recovers_the_exact_original_message_before_any_later_input_and_never_retargets_history()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage = Arc::new(Memory::default());
    let state = Arc::new(NativeState::default());
    state.uncertain.store(true, Ordering::SeqCst);
    let native = Arc::new(Native {
        session: "saved".to_owned(),
        state: state.clone(),
    });
    let artifacts = Arc::new(Inline);
    let publication = Publication::open(
        storage.clone(),
        native.clone(),
        artifacts.clone(),
        settings(),
        "chat",
        HistoryMode::Shared,
        None,
    )?;
    let batch = batch(&["!room:local"])?;
    let rooms = batch.cursors.keys().cloned().collect();
    publication.prepare(batch.clone(), batch.events.clone(), &identities(), 65536)?;
    assert!(
        publication
            .publish(&rooms, 65536, |_| true, CancellationToken::new())
            .await
            .is_err()
    );
    assert!(publication.recovering()?);
    assert!(publication.discard_unpublished().is_err());
    assert!(
        publication
            .prepare(batch.clone(), batch.events.clone(), &identities(), 65536)
            .is_err()
    );
    drop(publication);
    let changed = Arc::new(Native {
        session: "replacement".to_owned(),
        state: state.clone(),
    });
    let wrong = Publication::open(
        storage.clone(),
        changed,
        artifacts.clone(),
        settings(),
        "chat",
        HistoryMode::Shared,
        None,
    )?;
    assert!(
        wrong
            .recover(&rooms, CancellationToken::new())
            .await
            .is_err()
    );
    drop(wrong);
    let resumed = Publication::open(
        storage.clone(),
        native,
        artifacts,
        settings(),
        "chat",
        HistoryMode::Shared,
        None,
    )?;
    let completed = resumed
        .recover(&rooms, CancellationToken::new())
        .await?
        .ok_or("original input should be proved")?;
    assert_eq!(completed.batch.cursors, batch.cursors);
    assert_eq!(state.deliveries.lock().map_err(|_| failure())?.len(), 1);
    assert_eq!(
        completed.deliveries,
        [("!room:local".to_owned(), "saved".to_owned())]
    );
    resumed.acknowledge()?;
    assert!(!resumed.pending()?);
    Ok(())
}
#[tokio::test]
async fn per_room_histories_filter_revoked_rooms_and_pause_only_discards_unattempted_plans()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage = Arc::new(Memory::default());
    let state = Arc::new(NativeState::default());
    let native = Arc::new(Native {
        session: "saved".to_owned(),
        state: state.clone(),
    });
    let artifacts = Arc::new(Inline);
    let publication = Publication::open(
        storage,
        native,
        artifacts,
        settings(),
        "chat",
        HistoryMode::PerRoom,
        Some(InputPriority::Steering),
    )?;
    let batch = batch(&["!first:local", "!second:local"])?;
    publication.prepare(batch.clone(), batch.events.clone(), &identities(), 65536)?;
    publication.discard_unpublished()?;
    assert!(!publication.pending()?);
    publication.prepare(batch.clone(), batch.events.clone(), &identities(), 65536)?;
    let allowed = BTreeSet::from(["!second:local".to_owned()]);
    let completed = publication
        .publish(&allowed, 65536, |_| true, CancellationToken::new())
        .await?
        .ok_or("publication should complete")?;
    assert_eq!(completed.batch.cursors.len(), 1);
    let deliveries = state.deliveries.lock().map_err(|_| failure())?;
    assert_eq!(deliveries.len(), 1);
    assert!(!deliveries[0].1.contains("Request in !first:local"));
    assert_eq!(
        completed.deliveries,
        [("!second:local".to_owned(), "saved:!second:local".to_owned())]
    );
    publication.acknowledge()?;
    Ok(())
}
