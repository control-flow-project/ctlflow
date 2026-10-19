use crossfire_adapter_matrix::{
    agent::Client,
    protocol::{Protocol, Request, Response},
};
use crossfire_agent_core::receive_pages;
use crossfire_domain::messaging_client::{Direction, MessagePageRequest};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::json;
use std::{collections::BTreeMap, sync::Mutex};
use tokio_util::sync::CancellationToken;

struct Observed {
    path: String,
    query: BTreeMap<String, String>,
    maximum: usize,
}
struct Fixture {
    calls: Mutex<Vec<Observed>>,
    too_large: bool,
}
impl Protocol for Fixture {
    async fn request(&self, request: &Request, _stop: CancellationToken) -> Result<Response> {
        let mut calls = self
            .calls
            .lock()
            .map_err(|_| Failure::new(ErrorCode::Unavailable, "Test call ownership failed"))?;
        calls.push(Observed {
            path: request.path.clone(),
            query: request.query.clone(),
            maximum: request.maximum_bytes,
        });
        if self.too_large && calls.len() == 1 {
            return Err(Failure::new(ErrorCode::BodyTooLarge, "Large fixture page"));
        }
        let body = if request.path.ends_with("/messages") {
            json!({"chunk":[{"event_id":"$native","sender":"@owner:local","type":"m.room.message","content":{"msgtype":"m.text","body":"native"}}],"start":"old","end":"new"})
        } else if request.path.ends_with("/sync") {
            json!({"next_batch":"new","rooms":{"join":{}}})
        } else {
            json!({"joined_rooms":["!first:local","!second:local"]})
        };
        Ok(Response { status: 200, body })
    }
}
#[tokio::test]
async fn adaptive_pages_keep_the_same_cursor_and_use_the_declared_byte_budget()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let source = Fixture {
        calls: Mutex::new(Vec::new()),
        too_large: true,
    };
    let query = MessagePageRequest {
        direction: Direction::Forward,
        from: Some("old".to_owned()),
        to: None,
        limit: 2,
        filter: None,
    };
    let page = receive_pages::history(
        &Client::from_protocol(&source, "@agent:local")?,
        "!native/a:local",
        &query,
        CancellationToken::new(),
    )
    .await?;
    assert_eq!(page.requested_limit, 1);
    assert_eq!(page.end.as_deref(), Some("new"));
    let calls = source.calls.lock().map_err(|_| "test ownership")?;
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].maximum, 1024 * 1024);
    assert_eq!(calls[1].maximum, 64 * 1024 * 1024);
    assert!(calls.iter().all(
        |observed| observed.path.ends_with("!native%2Fa%3Alocal/messages")
            && observed.query.get("from").map(String::as_str) == Some("old")
    ));
    assert_eq!(receive_pages::room_quota(100, 20, 0), 10);
    assert_eq!(receive_pages::room_quota(100, 3, 0), 34);
    Ok(())
}
#[tokio::test]
async fn native_sync_and_joined_rooms_preserve_exact_authority_inputs()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let source = Fixture {
        calls: Mutex::new(Vec::new()),
        too_large: true,
    };
    let result = receive_pages::sync(
        &Client::from_protocol(&source, "@agent:local")?,
        Some("same-cursor"),
        0,
        CancellationToken::new(),
    )
    .await?;
    assert_eq!(result.cursor, "new");
    {
        let calls = source.calls.lock().map_err(|_| "test ownership")?;
        assert_eq!(calls.len(), 2);
        assert!(
            calls
                .iter()
                .all(|observed| observed.query.get("since").map(String::as_str)
                    == Some("same-cursor"))
        );
        let first: serde_json::Value =
            serde_json::from_str(calls[0].query.get("filter").ok_or("filter")?)?;
        let second: serde_json::Value =
            serde_json::from_str(calls[1].query.get("filter").ok_or("filter")?)?;
        assert_eq!(first["room"]["timeline"]["limit"], 100);
        assert_eq!(second["room"]["timeline"]["limit"], 50);
    }
    assert_eq!(
        receive_pages::joined(
            &Client::from_protocol(&source, "@agent:local")?,
            CancellationToken::new()
        )
        .await?
        .len(),
        2
    );
    Ok(())
}
