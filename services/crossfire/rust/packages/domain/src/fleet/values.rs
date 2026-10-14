use crate::identity::Actor;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fleet {
    pub id: String,
    pub owner_id: String,
    pub fleet_key: String,
    pub archived_at: Option<i64>,
    pub delivery_enabled: bool,
    pub label: String,
    pub controller_name: String,
    pub revision: i64,
    pub updated_at: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Credential {
    pub id: String,
    pub fleet_id: String,
    pub secret_hash: String,
    pub created_at: i64,
    pub revoked_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Connection {
    pub fleet_id: String,
    pub connection_id: String,
    pub credential_id: String,
    pub last_seen_at: i64,
    pub expires_at: i64,
    pub closed_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Instance {
    pub owner_id: String,
    pub fleet_key: String,
    pub instance_key: String,
    pub agent_id: String,
    pub retired_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FleetActor {
    Principal(Actor),
    Controller {
        fleet_id: String,
        credential_id: String,
    },
}
