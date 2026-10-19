use crate::native_values::{MatrixMembership, MatrixRoomFacts, RoomPower};
use crossfire_contracts::{enrollment::Digest, validation::SAFE_INTEGER};
use crossfire_domain::{
    messaging::{AccessField, BackendPermission, RoomFacts, RoomMembership},
    room_access::values::{Access, Intent},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde::Serialize;
use serde_json::{Value, json};

pub fn requested_power(
    facts: &MatrixRoomFacts,
    target: &str,
    intent: &Intent,
    reconcile: bool,
) -> Result<i64> {
    if facts.creator_ids.iter().any(|value| value == target) && intent.access != Access::Reply {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Matrix creator authority cannot be restricted by an agent grant",
        ));
    }
    let mut level = match intent.access {
        Access::Read if intent.native_access.is_none() => facts.read_level,
        Access::Reply if intent.native_access.is_none() => facts.reply_level,
        Access::Custom => intent
            .native_access
            .as_ref()
            .filter(|value| value.len() == 1)
            .and_then(|value| value.get("powerLevel"))
            .and_then(|value| {
                crossfire_contracts::validation::integer(value, -SAFE_INTEGER, SAFE_INTEGER).ok()
            })
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Invalid,
                    "Matrix custom access requires one finite integer powerLevel parameter",
                )
            })?,
        _ => {
            return Err(Failure::new(
                ErrorCode::Invalid,
                "Unsupported Matrix room access",
            ));
        }
    };
    if reconcile
        && intent.access == Access::Custom
        && let RoomPower::Level(maximum) = facts.power
    {
        level = level.min(maximum);
    }
    if matches!(facts.power, RoomPower::Level(maximum) if level > maximum) {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Requested access exceeds the authorizer’s Matrix room permissions",
        ));
    }
    Ok(level)
}

pub fn membership_view(member: MatrixMembership) -> RoomMembership {
    let (creator, level) = match member.power {
        RoomPower::Creator => (true, None),
        RoomPower::Level(level) => (false, Some(level)),
    };
    RoomMembership {
        backend_user_id: member.backend_user_id,
        display_name: member.display_name,
        membership: member.membership,
        native_access: Some(serde_json::Map::from_iter([
            ("creator".to_owned(), Value::Bool(creator)),
            ("powerLevel".to_owned(), json!(level)),
        ])),
    }
}

pub fn room_view(facts: MatrixRoomFacts, subject: Option<&str>) -> Result<RoomFacts> {
    #[derive(Serialize)]
    struct Permission<'a> {
        action: &'a str,
        level: i64,
    }
    #[derive(Serialize)]
    struct Revision<'a> {
        creator: bool,
        level: Option<i64>,
        creators: Vec<&'a str>,
        read: i64,
        reply: i64,
        invite: i64,
        permissions: Vec<Permission<'a>>,
    }
    let encoding = Digest::new()?;
    let mut permissions: Vec<_> = facts.native_permissions.iter().collect();
    permissions.sort_by(|left, right| encoding.compare(&left.action, &right.action));
    let (creator, level) = match facts.power {
        RoomPower::Creator => (true, None),
        RoomPower::Level(level) => (false, Some(level)),
    };
    let mut creators: Vec<_> = facts.creator_ids.iter().map(String::as_str).collect();
    creators.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
    let revision = serde_json::to_string(&Revision {
        creator,
        level,
        creators,
        read: facts.read_level,
        reply: facts.reply_level,
        invite: facts.invite_level,
        permissions: permissions
            .iter()
            .map(|value| Permission {
                action: &value.action,
                level: value.level,
            })
            .collect(),
    })
    .map_err(|_| Failure::new(ErrorCode::Native, "Matrix room authority cannot be encoded"))?;
    let maximum = level.unwrap_or(SAFE_INTEGER);
    let access_modes =
        if subject.is_some_and(|subject| facts.creator_ids.iter().any(|value| value == subject)) {
            vec![Access::Reply]
        } else if creator || facts.reply_level <= maximum {
            vec![Access::Read, Access::Reply, Access::Custom]
        } else {
            vec![Access::Read, Access::Custom]
        };
    let permissions = permissions
        .iter()
        .map(|value| BackendPermission {
            action: value.action.clone(),
            label: format!("{} · required level {}", value.action, value.level),
            allowed: creator || value.level <= maximum,
        })
        .collect();
    Ok(RoomFacts {
        room_id: facts.room_id,
        name: facts.name,
        topic: facts.topic,
        alias: facts.alias,
        backend_user_id: facts.backend_user_id,
        can_invite: creator || maximum >= facts.invite_level,
        access_modes,
        authority_revision: identity::hash(&revision),
        access_fields: vec![AccessField {
            key: "powerLevel".to_owned(),
            label: "Matrix power level".to_owned(),
            minimum: -SAFE_INTEGER,
            maximum,
            default_value: 0.min(maximum),
        }],
        permissions,
    })
}
