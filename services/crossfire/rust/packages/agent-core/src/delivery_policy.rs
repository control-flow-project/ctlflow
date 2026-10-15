use crossfire_domain::{
    room_access::values::{Access, Grant},
    runtime::values::HistoryMode,
};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Room {
    pub muted: bool,
    pub access: Access,
    pub power: Option<i64>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Policy {
    pub active: bool,
    pub mode: crossfire_domain::identity::WakeMode,
    pub rooms: BTreeMap<String, Room>,
    pub senders: BTreeSet<String>,
    pub max_message_bytes: usize,
    pub idle_timeout_seconds: u64,
    pub owner_conversation: Option<String>,
}
impl Policy {
    pub fn room(&self, room: &str) -> Option<&Room> {
        self.active.then(|| self.rooms.get(room)).flatten()
    }
    pub fn accepts(&self, room: &str, sender: &str) -> bool {
        self.room(room)
            .is_some_and(|room| !room.muted && self.senders.contains(sender))
    }
    pub fn can_reply(&self, room: &str) -> bool {
        self.room(room)
            .is_some_and(|room| matches!(room.access, Access::Reply | Access::Custom))
    }
    pub fn changed_rooms(&self, next: &Policy) -> BTreeSet<String> {
        self.rooms
            .iter()
            .filter(|(id, room)| next.rooms.get(*id) != Some(*room))
            .map(|(id, _)| id.clone())
            .collect()
    }
}
pub fn rooms(grants: &[Grant]) -> BTreeMap<String, Room> {
    grants
        .iter()
        .filter(|grant| grant.intent.access != Access::None)
        .map(|grant| {
            (
                grant.room_id.clone(),
                Room {
                    muted: grant.intent.muted,
                    access: grant.intent.access,
                    power: grant.intent.power,
                },
            )
        })
        .collect()
}
pub fn history_context(mode: HistoryMode, room: &str) -> &str {
    match mode {
        HistoryMode::Shared => "shared",
        HistoryMode::PerRoom => room,
    }
}
