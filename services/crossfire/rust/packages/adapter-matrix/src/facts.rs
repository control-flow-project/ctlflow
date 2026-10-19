use crate::account::Authority;
use crate::native_values::{MatrixRoomFacts, NativePermission, RoomPower};
use crate::room_state::{self, StateEvent};
use crossfire_contracts::validation;
use crossfire_domain::messaging::RoomFacts;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Map, Value};

fn content<'a>(events: &'a [StateEvent], event_type: &str) -> Option<&'a Map<String, Value>> {
    events
        .iter()
        .find(|event| event.event_type == event_type && event.state_key.is_empty())
        .map(|event| &event.content)
}

pub(crate) fn facts(events: &[StateEvent], user: &str, room: &str) -> Result<MatrixRoomFacts> {
    if !events.iter().any(|event| {
        event.event_type == "m.room.member"
            && event.state_key == user
            && event.content.get("membership").and_then(Value::as_str) == Some("join")
    }) {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Owner is not a current room member",
        ));
    }
    let powers = content(events, "m.room.power_levels")
        .ok_or_else(|| Failure::new(ErrorCode::Native, "Native room power levels are missing"))?;
    let levels = room_state::powers(powers, user)?;
    let creators = room_state::creators(events)?;
    let creator = creators.iter().any(|id| id == user);
    let read_level = levels
        .ceiling
        .min(if creator {
            validation::SAFE_INTEGER
        } else {
            levels.owner_level
        })
        .min(levels.ordinary - 1)
        .min(levels.message - 1)
        .min(levels.reaction - 1);
    if !(-validation::SAFE_INTEGER..=validation::SAFE_INTEGER).contains(&read_level) {
        return Err(Failure::new(
            ErrorCode::Native,
            "Invalid native permission levels",
        ));
    }
    let mut permissions = vec![
        NativePermission {
            action: "m.room.message".to_owned(),
            level: levels.message,
        },
        NativePermission {
            action: "m.reaction".to_owned(),
            level: levels.reaction,
        },
        NativePermission {
            action: "events_default".to_owned(),
            level: levels.ordinary,
        },
    ];
    for (action, default) in [
        ("invite", 0),
        ("kick", 50),
        ("ban", 50),
        ("redact", 50),
        ("state_default", 50),
    ] {
        permissions.push(NativePermission {
            action: action.to_owned(),
            level: room_state::level(powers.get(action).filter(|value| !value.is_null()), default)?,
        });
    }
    let empty = Map::new();
    let event_levels = powers
        .get("events")
        .filter(|value| !value.is_null())
        .map_or(Some(&empty), Value::as_object)
        .ok_or_else(|| Failure::new(ErrorCode::Native, "Invalid native power map"))?;
    for (action, value) in event_levels
        .iter()
        .filter(|(action, _)| !["m.room.message", "m.reaction"].contains(&action.as_str()))
    {
        permissions.push(NativePermission {
            action: action.clone(),
            level: room_state::level(Some(value), 0)?,
        });
    }
    let invite_level = room_state::level(powers.get("invite").filter(|value| !value.is_null()), 0)?;
    let kick_level = room_state::level(powers.get("kick").filter(|value| !value.is_null()), 50)?;
    let change_power_level = room_state::level(
        event_levels
            .get("m.room.power_levels")
            .filter(|value| !value.is_null()),
        room_state::level(
            powers.get("state_default").filter(|value| !value.is_null()),
            50,
        )?,
    )?;
    let name = content(events, "m.room.name")
        .and_then(|content| content.get("name"))
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .unwrap_or("Unnamed room");
    let topic = content(events, "m.room.topic")
        .and_then(|content| content.get("topic"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let alias = content(events, "m.room.canonical_alias")
        .and_then(|content| content.get("alias"))
        .and_then(Value::as_str);
    Ok(MatrixRoomFacts {
        room_id: room.to_owned(),
        name: crossfire_kernel::text::truncate_utf16(name, 255).to_owned(),
        topic: crossfire_kernel::text::truncate_utf16(topic, 4096).to_owned(),
        alias: alias.map(|alias| crossfire_kernel::text::truncate_utf16(alias, 255).to_owned()),
        backend_user_id: user.to_owned(),
        power: if creator {
            RoomPower::Creator
        } else {
            RoomPower::Level(levels.owner_level)
        },
        creator_ids: creators,
        read_level,
        reply_level: levels.message.max(levels.reaction),
        invite_level,
        kick_level,
        change_power_level,
        native_permissions: permissions,
    })
}

impl Authority {
    pub async fn room(&self, user: &str, room: &str, subject: Option<&str>) -> Result<RoomFacts> {
        let events = self.state(user, room).await?;
        crate::access::room_view(facts(&events, user, room)?, subject)
    }
    pub async fn authorize_room_access(
        &self,
        user: &str,
        target: &str,
        room: &str,
        intent: &crossfire_domain::room_access::values::Intent,
    ) -> Result<RoomFacts> {
        let events = self.state(user, room).await?;
        let facts = facts(&events, user, room)?;
        crate::access::requested_power(&facts, target, intent, false)?;
        crate::access::room_view(facts, Some(target))
    }
}
