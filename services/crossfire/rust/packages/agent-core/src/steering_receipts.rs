use crate::{
    events::{Event, invalid},
    owner_notices::Sink,
    source_control::{Control, Notices},
};
use crossfire_kernel::{
    Result,
    time::{Clock, iso_timestamp, parse_iso_timestamp},
};
use serde_json::json;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

pub struct Receipts<S, T> {
    pub sink: Arc<S>,
    pub clock: T,
    received: Mutex<BTreeMap<(String, String), i64>>,
}
impl<S: Sink, T: Clock + Send + Sync> Receipts<S, T> {
    pub fn new(sink: Arc<S>, clock: T) -> Self {
        Self {
            sink,
            clock,
            received: Mutex::new(BTreeMap::new()),
        }
    }
}
impl<S: Sink, T: Clock + Send + Sync> Notices for Receipts<S, T> {
    fn stage(&self, event: &Event, stage: &str, detail: Option<&str>) -> Result<()> {
        let label = match stage {
            "received" => "Mention received",
            "interrupted" => "Captured turn interrupted",
            "already-idle" => "Already idle — no turn interrupted",
            "accepted" => "Native input accepted",
            "superseded" => "Steering superseded — retained as unread context",
            "failed" => "Steering failed — native acceptance not confirmed",
            _ => return Err(invalid("Unknown steering receipt stage")),
        };
        let mut received = self
            .received
            .lock()
            .map_err(|_| invalid("Steering receipt ownership failed"))?;
        let key = (event.room_id.clone(), event.event_id.clone());
        let now = self.clock.now()?;
        if stage == "received" {
            if received.len() >= 1000 && !received.contains_key(&key) {
                return Err(invalid(
                    "Unfinished steering receipts exceed their bounded capacity",
                ));
            }
            received.entry(key.clone()).or_insert(now);
        }
        let first = received.get(&key).copied();
        let sent = event
            .timestamp
            .as_deref()
            .map(parse_iso_timestamp)
            .transpose()?;
        let mut value = json!({"eventId":event.event_id,"source":event.origin,"roomId":event.room_id,"sender":event.sender,"sentAt":event.timestamp,"receivedAt":first.map(iso_timestamp).transpose()?,"stageAt":iso_timestamp(now)?,"sinceReceiptMs":first.map(|first| now.saturating_sub(first).max(0)),"sinceSentMs":sent.map(|sent| now.saturating_sub(sent).max(0))});
        if stage == "received" {
            value["message"] = json!(
                event.content["body"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(3000)
                    .collect::<String>()
            );
        }
        if let Some(detail) = detail {
            value["detail"] = json!(detail.chars().take(3000).collect::<String>());
        }
        self.sink.notice(
            &json!([
                "steering",
                json!([event.room_id, event.event_id]).to_string(),
                stage
            ])
            .to_string(),
            &format!("{label}\n{value}"),
        )?;
        if matches!(stage, "accepted" | "superseded") {
            received.remove(&key);
        }
        Ok(())
    }
    fn superseded(&self, previous: &Control, replacement: &Event) -> Result<()> {
        self.received
            .lock()
            .map_err(|_| invalid("Steering receipt ownership failed"))?
            .remove(&(previous.room.clone(), previous.event.clone()));
        self.sink.notice(&json!(["steering",json!([previous.room,previous.event]).to_string(),"superseded"]).to_string(), &format!("Steering superseded by a newer mention. Confirmed input remains in native history; unconfirmed input remains unread.\n{}", json!({"roomId":previous.room,"eventId":previous.event,"replacedBy":replacement.event_id,"stageAt":iso_timestamp(self.clock.now()?)?})))
    }
}
