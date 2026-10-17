use crossfire_kernel::secret::Secret;

#[derive(Debug, Clone)]
pub struct Account {
    pub user_id: String,
    pub access_token: Secret,
    pub device_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoomPower {
    Creator,
    Level(i64),
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
    pub matrix_user_id: String,
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
pub struct RoomFacts {
    pub room_id: String,
    pub name: String,
    pub topic: String,
    pub alias: Option<String>,
    pub matrix_user_id: String,
    pub power: RoomPower,
    pub creator_ids: Vec<String>,
    pub read_level: i64,
    pub reply_level: i64,
    pub invite_level: i64,
    pub kick_level: i64,
    pub change_power_level: i64,
    pub native_permissions: Vec<NativePermission>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessMode {
    Read,
    Reply,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoomAccess {
    pub mode: AccessMode,
    pub power_level: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomInvitation {
    pub room_id: String,
    pub event_id: String,
    pub sender_matrix_id: String,
    pub direct: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoomAdmission {
    Managed,
    Invitation {
        event_id: String,
        sender_matrix_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MatrixEvent {
    pub event_id: String,
    pub room_id: String,
    pub sender_matrix_id: String,
    pub event_type: String,
    pub message_type: Option<String>,
    pub body: Option<String>,
    pub mentions: Vec<String>,
    pub edited: bool,
    pub control: bool,
}

pub trait MatrixAuthority: crate::port::MatrixIdentity {
    fn exists(
        &self,
        user: &str,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<bool>> + Send;
    fn provision(
        &self,
        user: &str,
        password: &Secret,
        device: &str,
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
        access: RoomAccess,
        admission: Option<&RoomAdmission>,
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<RoomMembership>> + Send;
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
    ) -> impl std::future::Future<Output = crossfire_kernel::Result<MatrixEvent>> + Send;
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
