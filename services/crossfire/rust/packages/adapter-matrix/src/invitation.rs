use crate::account::{API, Authority, OperationKey};
use crossfire_contracts::origin::segment;
use crossfire_domain::messaging::RoomInvitation;
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use reqwest::Method;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Clone)]
pub(crate) struct InvitationState {
    pub(crate) since: String,
    pub(crate) senders: BTreeMap<String, String>,
}

fn updates(value: Option<&Value>, recipient: &str) -> Result<BTreeMap<String, String>> {
    let empty = serde_json::Map::new();
    let rooms = value
        .filter(|value| !value.is_null())
        .map_or(Some(&empty), Value::as_object)
        .filter(|rooms| rooms.len() <= 1000)
        .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native invitations"))?;
    let mut senders = BTreeMap::new();
    for (room, raw) in rooms {
        crate::syntax::room_id(&json!(room)).map_err(|_| {
            Failure::new(ErrorCode::Native, "Invalid native invitation room identity")
        })?;
        let events = raw
            .get("invite_state")
            .and_then(Value::as_object)
            .and_then(|state| state.get("events"))
            .and_then(Value::as_array)
            .filter(|events| events.len() <= 1000)
            .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native invitation state"))?;
        for event in events {
            if !event.is_object() {
                return Err(Failure::new(
                    ErrorCode::Native,
                    "Invalid native invitation event",
                ));
            }
            if event.get("type").and_then(Value::as_str) != Some("m.room.member")
                || event.get("state_key").and_then(Value::as_str) != Some(recipient)
            {
                continue;
            }
            if event
                .get("content")
                .and_then(Value::as_object)
                .and_then(|content| content.get("membership"))
                .and_then(Value::as_str)
                != Some("invite")
            {
                return Err(Failure::new(
                    ErrorCode::Native,
                    "Invalid native invitation author",
                ));
            }
            let sender = crate::syntax::user_id(event.get("sender").unwrap_or(&Value::Null))
                .map_err(|_| Failure::new(ErrorCode::Native, "Invalid native invitation author"))?;
            senders.insert(room.clone(), sender.to_owned());
        }
        if !senders.contains_key(room) {
            return Err(Failure::new(
                ErrorCode::Native,
                "Native invitation has no recipient membership",
            ));
        }
    }
    Ok(senders)
}

impl Authority {
    async fn synchronize_invitations(
        &self,
        token: &Secret,
        user: &str,
        previous: Option<&InvitationState>,
    ) -> Result<InvitationState> {
        let filter = filter();
        let filter = serde_json::to_string(&filter)
            .map_err(|_| Failure::new(ErrorCode::Native, "Invalid native invitation filter"))?;
        let path = format!(
            "{API}/sync?timeout=0&filter={}{}",
            segment(&filter),
            previous
                .map(|state| format!("&since={}", segment(&state.since)))
                .unwrap_or_default()
        );
        let response = self.http.ok(Some(token), Method::GET, &path, None).await?;
        apply(&response, user, previous)
    }

    pub async fn invitation(&self, user: &str, room: &str) -> Result<Option<RoomInvitation>> {
        crate::syntax::room_id(&json!(room))?;
        let _guard = self
            .exclusive(OperationKey::Invitations(user.to_owned()))
            .await?;
        let token = self.as_user(user).await?;
        let previous = self.cache.invitations(user)?;
        let previous = match previous {
            Some(previous) => previous,
            None => {
                let initial = self.synchronize_invitations(&token, user, None).await?;
                self.cache.remember_invitations(user, initial.clone())?;
                initial
            }
        };
        let current = self
            .synchronize_invitations(&token, user, Some(&previous))
            .await?;
        let sender = current.senders.get(room).cloned();
        self.cache.remember_invitations(user, current)?;
        let Some(sender) = sender else {
            return Ok(None);
        };
        if !sender.ends_with(&format!(":{}", self.configuration.server_name)) {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "The native inviter must be a local Crossfire identity",
            ));
        }
        self.invitation_event(user, room, &sender).await
    }
}

pub(crate) fn filter() -> Value {
    json!({"room":{"timeline":{"limit":0},"state":{"types":["m.room.member"]},"ephemeral":{"types":[]},"account_data":{"types":[]}},"presence":{"types":[]},"account_data":{"types":[]}})
}
pub(crate) fn apply(
    response: &Value,
    user: &str,
    previous: Option<&InvitationState>,
) -> Result<InvitationState> {
    let empty = serde_json::Map::new();
    let rooms = response
        .get("rooms")
        .filter(|value| !value.is_null())
        .map_or(Some(&empty), Value::as_object)
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Native,
                "Invalid native invitation synchronization",
            )
        })?;
    let since = response
        .get("next_batch")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.encode_utf16().count() <= 1024)
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Native,
                "Invalid native invitation synchronization",
            )
        })?
        .to_owned();
    let invited = updates(rooms.get("invite"), user)?;
    let joined = rooms
        .get("join")
        .filter(|value| !value.is_null())
        .map_or(Some(&empty), Value::as_object);
    let left = rooms
        .get("leave")
        .filter(|value| !value.is_null())
        .map_or(Some(&empty), Value::as_object);
    let (Some(joined), Some(left)) = (joined, left) else {
        return Err(Failure::new(
            ErrorCode::Native,
            "Invalid native invitation membership updates",
        ));
    };
    let mut senders = previous
        .map(|previous| previous.senders.clone())
        .unwrap_or_default();
    senders.extend(invited);
    for room in joined.keys().chain(left.keys()) {
        senders.remove(room);
    }
    if senders.len() > 1000 {
        return Err(Failure::new(
            ErrorCode::Native,
            "Native pending invitations exceed the room limit",
        ));
    }
    Ok(InvitationState { since, senders })
}
