use crossfire_kernel::{Result, secret::Secret};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub user_id: String,
    pub access_token: Secret,
    pub native: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendConfiguration {
    pub backend_type: String,
    pub parameters: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendDescription {
    pub backend_type: String,
    pub label: String,
    pub chat_url: String,
    pub signup_url: String,
    pub signup_instructions: Vec<String>,
    pub configuration: BackendConfiguration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Membership {
    Join,
    Invite,
    Leave,
    Ban,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomMembership {
    pub backend_user_id: String,
    pub display_name: String,
    pub membership: Membership,
    pub native_access: Option<Map<String, Value>>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendPermission {
    pub action: String,
    pub label: String,
    pub allowed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessField {
    pub key: String,
    pub label: String,
    pub minimum: i64,
    pub maximum: i64,
    pub default_value: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomFacts {
    pub room_id: String,
    pub name: String,
    pub topic: String,
    pub alias: Option<String>,
    pub backend_user_id: String,
    pub can_invite: bool,
    pub authority_revision: String,
    pub access_modes: Vec<crate::room_access::values::Access>,
    pub access_fields: Vec<AccessField>,
    pub permissions: Vec<BackendPermission>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomInvitation {
    pub room_id: String,
    pub event_id: String,
    pub sender_backend_user_id: String,
    pub direct: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoomAdmission {
    Managed,
    Invitation {
        event_id: String,
        sender_backend_user_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendEvent {
    pub event_id: String,
    pub room_id: String,
    pub sender_backend_user_id: String,
    pub event_type: String,
    pub message_type: Option<String>,
    pub body: Option<String>,
    pub mentions: Vec<String>,
    pub edited: bool,
    pub control: bool,
}

pub trait MessagingAuthority: crate::port::BackendUserIdentity + Send + Sync + 'static {
    fn describe(&self, public_origin: &str) -> BackendDescription;
    fn authenticate(
        &self,
        username: &str,
        password: &Secret,
    ) -> impl std::future::Future<Output = Result<Secret>> + Send;
    fn agent_account(&self, user: &str, token: Secret) -> Account;
    fn agent_user_id(&self, id: &str) -> String;
    fn service_user_id(&self) -> &str;
    fn local_label(&self, user: &str) -> Result<String>;
    fn registration_user_id(
        &self,
        username: &str,
        password: &Secret,
        native: &Map<String, Value>,
    ) -> Result<String>;
    fn exists(
        &self,
        user: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<bool>> + Send;
    fn provision(
        &self,
        user: &str,
        password: &Secret,
        native: &Map<String, Value>,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<Account>> + Send;
    fn deactivate(
        &self,
        user: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<()>> + Send;
    fn discard(
        &self,
        user: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<()>> + Send;
    fn profile_name(
        &self,
        user: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<Option<String>>> + Send;
    fn set_display_name(
        &self,
        user: &str,
        name: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<()>> + Send;
    fn joined(
        &self,
        user: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<Vec<String>>> + Send;
    fn owner_conversation(
        &self,
        owner: &str,
        agent: &str,
        selected: Option<&str>,
        previous_name: Option<&str>,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<String>> + Send;
    fn verify_owner_conversation(
        &self,
        owner: &str,
        agent: &str,
        room: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<()>> + Send;
    fn mark_direct(
        &self,
        user: &str,
        counterpart: &str,
        room: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<()>> + Send;
    fn room(
        &self,
        user: &str,
        room: &str,
        subject: Option<&str>,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<RoomFacts>> + Send;
    fn membership(
        &self,
        user: &str,
        target: &str,
        room: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<RoomMembership>> + Send;
    fn invitation(
        &self,
        user: &str,
        room: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<Option<RoomInvitation>>> + Send;
    fn set_room_access(
        &self,
        user: &str,
        target: &str,
        room: &str,
        access: &crate::room_access::values::Intent,
        admission: Option<&RoomAdmission>,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<RoomMembership>> + Send;
    fn authorize_room_access(
        &self,
        user: &str,
        target: &str,
        room: &str,
        access: &crate::room_access::values::Intent,
    ) -> impl std::future::Future<Output = Result<RoomFacts>> + Send;
    fn leave(
        &self,
        user: &str,
        room: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<()>> + Send;
    fn event(
        &self,
        user: &str,
        room: &str,
        event: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<BackendEvent>> + Send;
    fn send_notice(
        &self,
        user: &str,
        room: &str,
        transaction_id: &str,
        body: &str,
        sender: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<String>> + Send;
    fn close(&self);
}
