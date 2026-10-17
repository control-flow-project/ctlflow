mod support;
use crossfire_agent_core::{
    matrix::{Matrix, Request, Response},
    profile::Settings,
    receive_state,
    unread::{self, HistoryEnd, Options, Window},
};
use crossfire_contracts::operations::Method;
use crossfire_kernel::{Result, failure::ErrorCode};
use serde_json::json;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
#[path = "support/artifacts.rs"]
mod artifacts;
use artifacts::Inline;
use support::{Memory, failure};
use tokio_util::sync::CancellationToken;

struct Native {
    queries: Mutex<Vec<BTreeMap<String, String>>>,
    fail_receipt: AtomicBool,
    rooms: Vec<String>,
}
impl Matrix for Native {
    async fn request(&self, request: &Request, _stop: CancellationToken) -> Result<Response> {
        if request.path.ends_with("/joined_rooms") {
            return Ok(Response {
                status: 200,
                body: json!({"joined_rooms":self.rooms}),
            });
        }
        if request.path.ends_with("/read_markers") {
            if self.fail_receipt.swap(false, Ordering::SeqCst) {
                return Err(failure());
            }
            assert_eq!(request.method, Method::Post);
            assert!(
                request
                    .body
                    .as_ref()
                    .is_some_and(|body| body["m.read.private"] == body["m.fully_read"])
            );
            return Ok(Response {
                status: 200,
                body: json!({}),
            });
        }
        self.queries
            .lock()
            .map_err(|_| failure())?
            .push(request.query.clone());
        let from = request.query.get("from").map(String::as_str);
        let body = match from {
            None => {
                json!({"chunk":[{"event_id":"$newest","sender":"@human:local","type":"m.room.message","content":{"body":"newest","msgtype":"m.text"},"origin_server_ts":10}],"end":"latest"})
            }
            Some("latest") => {
                json!({"chunk":[{"event_id":"$older","sender":"@human:local","type":"m.room.message","content":{"body":"older","msgtype":"m.text"},"origin_server_ts":1}],"end":"oldest"})
            }
            Some("saved") => {
                json!({"chunk":[{"event_id":"$fresh","sender":"@human:local","type":"m.room.message","content":{"body":"not yet seen","msgtype":"m.text"},"origin_server_ts":20}],"end":"after"})
            }
            Some("repeat") => {
                json!({"chunk":[{"event_id":"$bad","sender":"@human:local","type":"m.room.message","content":{"body":"bad"}}],"end":"repeat"})
            }
            _ => json!({"chunk":[],"end":"complete"}),
        };
        Ok(Response { status: 200, body })
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

#[tokio::test]
async fn fresh_rooms_get_a_bounded_recent_floor_without_marking_old_history_or_other_rooms_seen()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let rooms: Vec<_> = (0..12)
        .map(|index| format!("!room-{index}:local"))
        .collect();
    let native = Native {
        queries: Mutex::default(),
        fail_receipt: AtomicBool::new(false),
        rooms: rooms.clone(),
    };
    let allowed = rooms.into_iter().collect();
    let storage = Memory::default();
    let batch = unread::read(
        &storage,
        &native,
        &settings(),
        &Inline,
        Options {
            file: "cursor",
            limit: 100,
            maximum: 65536,
            selector: None,
            boundary: None,
            allowed: &allowed,
            window: None,
        },
        CancellationToken::new(),
    )
    .await?;
    assert_eq!(batch.events.len(), 24);
    assert_eq!(batch.cursors.len(), 12);
    assert!(batch.cursors.values().all(|cursor| cursor == "latest"));
    assert!(batch.more_rooms.is_empty());
    assert!(receive_state::load(&storage, "cursor")?.is_empty());
    assert_eq!(
        native
            .queries
            .lock()
            .map_err(|_| failure())?
            .iter()
            .filter(|query| query.get("limit").map(String::as_str) == Some("9"))
            .count(),
        12
    );
    receive_state::acknowledge(
        &storage,
        &native,
        "cursor",
        &batch,
        CancellationToken::new(),
    )
    .await?;
    assert_eq!(receive_state::load(&storage, "cursor")?, batch.cursors);
    Ok(())
}
#[tokio::test]
async fn saved_positions_read_only_forward_to_the_captured_room_boundary_and_failed_receipts_are_recoverable()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage = Memory::default();
    let room = "!room:local".to_owned();
    let allowed = BTreeSet::from([room.clone()]);
    let native = Native {
        queries: Mutex::default(),
        fail_receipt: AtomicBool::new(true),
        rooms: vec![room.clone()],
    };
    let cursors = BTreeMap::from([(room.clone(), "saved".to_owned())]);
    let ends = BTreeMap::from([(
        room.clone(),
        HistoryEnd {
            cursor: "boundary".to_owned(),
            event: Some(
                json!({"event_id":"$terminal","sender":"@human:local","type":"m.room.message","content":{"msgtype":"m.text","body":"terminal"},"origin_server_ts":21}),
            ),
        },
    )]);
    let batch = unread::read(
        &storage,
        &native,
        &settings(),
        &Inline,
        Options {
            file: "cursor",
            limit: 100,
            maximum: 65536,
            selector: Some(&room),
            boundary: None,
            allowed: &allowed,
            window: Some(Window {
                cursors: &cursors,
                ends: &ends,
            }),
        },
        CancellationToken::new(),
    )
    .await?;
    assert_eq!(batch.events.len(), 2);
    assert_eq!(batch.cursors[&room], "boundary");
    {
        let queries = native.queries.lock().map_err(|_| failure())?;
        assert_eq!(queries[0]["dir"], "f");
        assert_eq!(queries[0]["from"], "saved");
        assert_eq!(queries[0]["to"], "boundary");
    }
    assert!(
        receive_state::acknowledge(
            &storage,
            &native,
            "cursor",
            &batch,
            CancellationToken::new()
        )
        .await
        .is_err()
    );
    assert_eq!(receive_state::load(&storage, "cursor")?, batch.cursors);
    receive_state::flush(&storage, &native, "cursor", CancellationToken::new()).await?;
    assert_eq!(receive_state::load(&storage, "cursor")?, batch.cursors);
    Ok(())
}
#[tokio::test]
async fn repeated_native_positions_and_unjoined_selected_rooms_do_not_advance_state()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let storage = Memory::default();
    let native = Native {
        queries: Mutex::default(),
        fail_receipt: AtomicBool::new(false),
        rooms: vec!["!room:local".to_owned()],
    };
    let allowed = BTreeSet::from(["!room:local".to_owned(), "!unjoined:local".to_owned()]);
    let result = unread::read(
        &storage,
        &native,
        &settings(),
        &Inline,
        Options {
            file: "cursor",
            limit: 100,
            maximum: 65536,
            selector: Some("!unjoined:local"),
            boundary: None,
            allowed: &allowed,
            window: None,
        },
        CancellationToken::new(),
    )
    .await;
    assert_eq!(
        result.err().map(|error| error.code),
        Some(ErrorCode::Forbidden)
    );
    let cursors = BTreeMap::from([("!room:local".to_owned(), "repeat".to_owned())]);
    crossfire_agent_core::local_state::write(&storage, "cursor", &cursors, 65536)?;
    let result = unread::read(
        &storage,
        &native,
        &settings(),
        &Inline,
        Options {
            file: "cursor",
            limit: 100,
            maximum: 65536,
            selector: Some("!room:local"),
            boundary: None,
            allowed: &allowed,
            window: None,
        },
        CancellationToken::new(),
    )
    .await;
    assert!(result.is_err());
    assert_eq!(receive_state::load(&storage, "cursor")?, cursors);
    Ok(())
}
