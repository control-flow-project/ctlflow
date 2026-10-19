use crossfire_domain::messaging::Membership;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoomPower {
    Creator,
    Level(i64),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatrixMembership {
    pub backend_user_id: String,
    pub display_name: String,
    pub membership: Membership,
    pub power: RoomPower,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NativePermission {
    pub action: String,
    pub level: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatrixRoomFacts {
    pub room_id: String,
    pub name: String,
    pub topic: String,
    pub alias: Option<String>,
    pub backend_user_id: String,
    pub power: RoomPower,
    pub creator_ids: Vec<String>,
    pub read_level: i64,
    pub reply_level: i64,
    pub invite_level: i64,
    pub kick_level: i64,
    pub change_power_level: i64,
    pub native_permissions: Vec<NativePermission>,
}
