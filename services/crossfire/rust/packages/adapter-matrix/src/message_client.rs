use crate::{
    agent::Client,
    message_events,
    protocol::{self, API, Request},
    receive_pages,
};
use crossfire_contracts::{operations::Method, origin::segment};
use crossfire_domain::messaging_client::*;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use tokio_util::sync::CancellationToken;

fn invalid(message: &str) -> Failure {
    Failure::new(ErrorCode::Invalid, message)
}
impl<T: protocol::Protocol> Client<T> {
    pub(crate) async fn raw_history(
        &self,
        room: &str,
        request: &MessagePageRequest,
        stop: CancellationToken,
    ) -> Result<receive_pages::Page> {
        let mut query = BTreeMap::from([(
            "dir".to_owned(),
            if request.direction == Direction::Forward {
                "f"
            } else {
                "b"
            }
            .to_owned(),
        )]);
        if let Some(from) = &request.from {
            query.insert("from".to_owned(), from.clone());
        }
        if let Some(to) = &request.to {
            query.insert("to".to_owned(), to.clone());
        }
        if let Some(filter) = &request.filter {
            let mut fields = serde_json::Map::new();
            if let Some(types) = &filter.types {
                fields.insert(
                    "types".to_owned(),
                    json!(message_events::native_types(types)?),
                );
            }
            if let Some(senders) = &filter.senders {
                for sender in senders {
                    crate::syntax::user_id(&json!(sender))?;
                }
                fields.insert("senders".to_owned(), json!(senders));
            }
            query.insert("filter".to_owned(), Value::Object(fields).to_string());
        }
        receive_pages::history(self, room, &query, request.limit, stop).await
    }
    pub(crate) async fn state_values(
        &self,
        room: &str,
        stop: CancellationToken,
    ) -> Result<Vec<Value>> {
        crate::syntax::room_id(&json!(room))?;
        let mut request = Request::new(Method::Get, format!("{API}/rooms/{}/state", segment(room)));
        request.maximum_bytes = 64 * 1024 * 1024;
        let value = protocol::request(self, &request, stop).await?;
        crate::room_state::state(&value)?;
        value
            .as_array()
            .cloned()
            .ok_or_else(|| invalid("Invalid Matrix room state"))
    }
}
impl<T: protocol::Protocol> MessagingClient for Client<T> {
    async fn identify(&self, stop: CancellationToken) -> Result<String> {
        let value = protocol::request(
            self,
            &Request::new(Method::Get, format!("{API}/account/whoami")),
            stop,
        )
        .await?;
        crate::syntax::user_id(value.get("user_id").unwrap_or(&Value::Null)).map(str::to_owned)
    }
    async fn joined_rooms(&self, stop: CancellationToken) -> Result<BTreeSet<String>> {
        receive_pages::joined(self, stop).await
    }
    async fn joined_members(
        &self,
        room: &str,
        stop: CancellationToken,
    ) -> Result<BTreeSet<String>> {
        let value = protocol::request(
            self,
            &Request::new(
                Method::Get,
                format!("{API}/rooms/{}/joined_members", segment(room)),
            ),
            stop,
        )
        .await?;
        value
            .get("joined")
            .and_then(Value::as_object)
            .ok_or_else(|| invalid("Invalid Matrix joined-member list"))?
            .keys()
            .map(|value| crate::syntax::user_id(&json!(value)).map(str::to_owned))
            .collect()
    }
    async fn synchronize(
        &self,
        since: Option<&str>,
        timeout: u64,
        stop: CancellationToken,
    ) -> Result<MessageFeed> {
        let timeout = u32::try_from(timeout).map_err(|_| invalid("Invalid Matrix sync timeout"))?;
        let value = receive_pages::sync(self, since, timeout, stop.clone()).await?;
        crate::message_feed::parse(self, value, since, stop).await
    }
    async fn history(
        &self,
        room: &str,
        request: &MessagePageRequest,
        stop: CancellationToken,
    ) -> Result<MessagePage> {
        let page = self.raw_history(room, request, stop).await?;
        Ok(MessagePage {
            events: page
                .chunk
                .iter()
                .map(|value| message_events::parse(value, room))
                .collect::<Result<_>>()?,
            start: page.start,
            end: page.end,
            requested_limit: page.requested_limit,
        })
    }
    async fn event(&self, room: &str, id: &str, stop: CancellationToken) -> Result<MessageEvent> {
        crate::syntax::event_id(&json!(id))?;
        let value = protocol::request(
            self,
            &Request::new(
                Method::Get,
                format!("{API}/rooms/{}/event/{}", segment(room), segment(id)),
            ),
            stop,
        )
        .await?;
        let parsed = message_events::parse(&value, room)?;
        if parsed.event_id != id {
            return Err(invalid("Matrix event identity changed"));
        }
        Ok(parsed)
    }
    async fn room_state(&self, room: &str, stop: CancellationToken) -> Result<Vec<Value>> {
        self.state_values(room, stop).await
    }
    async fn origins(
        &self,
        user: &str,
        rooms: &[String],
        stop: CancellationToken,
    ) -> Result<BTreeMap<String, RoomOrigin>> {
        crate::message_feed::origins(self, user, rooms, stop).await
    }
    async fn acknowledge(&self, room: &str, event: &str, stop: CancellationToken) -> Result<()> {
        let mut request = Request::new(
            Method::Post,
            format!("{API}/rooms/{}/read_markers", segment(room)),
        );
        request.body = Some(json!({"m.fully_read":event,"m.read.private":event}));
        protocol::request(self, &request, stop).await.map(|_| ())
    }
    async fn send_notice(
        &self,
        room: &str,
        transaction: &str,
        body: &str,
        stop: CancellationToken,
    ) -> Result<()> {
        if !self.notice_fits(body) {
            return Err(invalid(
                "Encoded owner notice exceeds the Matrix message limit",
            ));
        }
        let mut request = Request::new(
            Method::Put,
            format!(
                "{API}/rooms/{}/send/m.room.message/{}",
                segment(room),
                segment(transaction)
            ),
        );
        request.body = Some(crate::notices::content(body));
        protocol::request(self, &request, stop).await.map(|_| ())
    }
    async fn thinking(
        &self,
        room: &str,
        user: &str,
        enabled: bool,
        timeout: u64,
        stop: CancellationToken,
    ) -> Result<()> {
        let mut request = Request::new(
            Method::Put,
            format!("{API}/rooms/{}/typing/{}", segment(room), segment(user)),
        );
        request.body = Some(if enabled {
            json!({"typing":true,"timeout":timeout})
        } else {
            json!({"typing":false})
        });
        protocol::request(self, &request, stop).await.map(|_| ())
    }
    async fn verify_private_conversation(
        &self,
        room: &str,
        owner: &str,
        agent: &str,
        stop: CancellationToken,
    ) -> Result<()> {
        let state = self.state_values(room, stop).await?;
        let events = crate::room_state::state(&json!(state))?;
        crate::room_state::owner_conversation(&events, owner, agent)?;
        for participant in [owner, agent] {
            if !events.iter().any(|value| {
                value.event_type == "m.room.member"
                    && value.state_key == participant
                    && value.content.get("membership").and_then(Value::as_str) == Some("join")
            }) {
                return Err(Failure::new(
                    ErrorCode::Forbidden,
                    "Both private conversation participants must have joined",
                ));
            }
        }
        let empty = serde_json::Map::new();
        let power = events
            .iter()
            .find(|value| value.event_type == "m.room.power_levels" && value.state_key.is_empty())
            .map_or(&empty, |value| &value.content);
        let levels = crate::room_state::powers(power, agent)?;
        if levels.owner_level < levels.message {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Agent cannot send the decision to its owner",
            ));
        }
        Ok(())
    }
    fn notice_fits(&self, text: &str) -> bool {
        crate::notices::fits(text)
    }
    fn notice_chunks(&self, text: &str) -> Vec<String> {
        crate::notices::chunks(text)
    }
}
