use crossfire_kernel::Result;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EventType {
    Message,
    Membership,
    Name,
    Topic,
    Access,
    JoinPolicy,
    HistoryPolicy,
    Encryption,
    Encrypted,
    Redaction,
    Migration,
    Other,
}
impl EventType {
    pub fn code(self) -> &'static str {
        match self {
            Self::Message => "message",
            Self::Membership => "membership",
            Self::Name => "name",
            Self::Topic => "topic",
            Self::Access => "access",
            Self::JoinPolicy => "join-policy",
            Self::HistoryPolicy => "history-policy",
            Self::Encryption => "encryption",
            Self::Encrypted => "encrypted",
            Self::Redaction => "redaction",
            Self::Migration => "migration",
            Self::Other => "other",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageKind {
    Text,
    Notice,
    Image,
    File,
    Audio,
    Video,
    Location,
    Other,
}
impl MessageKind {
    pub fn code(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Notice => "notice",
            Self::Image => "image",
            Self::File => "file",
            Self::Audio => "audio",
            Self::Video => "video",
            Self::Location => "location",
            Self::Other => "other",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageAttachment {
    pub id: String,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub name: Option<String>,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub media_type: Option<String>,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub bytes: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageContent {
    pub kind: MessageKind,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub body: Option<String>,
    pub mentions: Vec<String>,
    pub edited: bool,
    pub control: bool,
    pub attachments: Vec<MessageAttachment>,
    pub attributes: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageEvent {
    pub event_id: String,
    pub room_id: String,
    pub sender: String,
    #[serde(rename = "type")]
    pub event_type: EventType,
    pub content: MessageContent,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub subject_id: Option<String>,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub sent_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub omitted: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Forward,
    Backward,
}

#[derive(Debug, Clone)]
pub struct EventFilter {
    pub types: Option<Vec<EventType>>,
    pub senders: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
pub struct MessagePageRequest {
    pub direction: Direction,
    pub limit: usize,
    pub from: Option<String>,
    pub to: Option<String>,
    pub filter: Option<EventFilter>,
}

#[derive(Debug, Clone)]
pub struct MessagePage {
    pub events: Vec<MessageEvent>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub requested_limit: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OriginKind {
    Unknown,
    Dm,
    Room,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoomOrigin {
    pub kind: OriginKind,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub name: Option<String>,
    #[serde(deserialize_with = "crossfire_kernel::data::required_option")]
    pub alias: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RoomFeed {
    pub events: Vec<MessageEvent>,
    pub limited: bool,
    pub previous_cursor: Option<String>,
    pub notifications: Option<Value>,
    pub read_state: Vec<Value>,
}

#[derive(Debug, Clone)]
pub struct MessageFeed {
    pub cursor: String,
    pub rooms: BTreeMap<String, RoomFeed>,
    pub invitations: Vec<String>,
    pub departed_rooms: Vec<String>,
    pub reset_rooms: Vec<String>,
}

pub trait InvitationReader: Send + Sync {
    fn invitation_rooms(
        &self,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<BTreeSet<String>>> + Send;
}

pub trait MessagingConnector: Send + Sync + 'static {
    type Client: MessagingClient + InvitationReader + 'static;
    fn connect(
        &self,
        configuration: &crate::messaging::BackendConfiguration,
        account: &crate::messaging::Account,
        maximum_upload_bytes: usize,
        stop: CancellationToken,
    ) -> Result<Self::Client>;
}

pub trait MessagingClient: Send + Sync {
    fn identify(&self, stop: CancellationToken) -> impl Future<Output = Result<String>> + Send;
    fn joined_rooms(
        &self,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<BTreeSet<String>>> + Send;
    fn joined_members(
        &self,
        room: &str,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<BTreeSet<String>>> + Send;
    fn synchronize(
        &self,
        since: Option<&str>,
        timeout: u64,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<MessageFeed>> + Send;
    fn history(
        &self,
        room: &str,
        request: &MessagePageRequest,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<MessagePage>> + Send;
    fn event(
        &self,
        room: &str,
        id: &str,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<MessageEvent>> + Send;
    fn room_state(
        &self,
        room: &str,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<Vec<Value>>> + Send;
    fn origins(
        &self,
        user: &str,
        rooms: &[String],
        stop: CancellationToken,
    ) -> impl Future<Output = Result<BTreeMap<String, RoomOrigin>>> + Send;
    fn acknowledge(
        &self,
        room: &str,
        event: &str,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn send_notice(
        &self,
        room: &str,
        transaction: &str,
        body: &str,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn thinking(
        &self,
        room: &str,
        user: &str,
        enabled: bool,
        timeout: u64,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn verify_private_conversation(
        &self,
        room: &str,
        owner: &str,
        agent: &str,
        stop: CancellationToken,
    ) -> impl Future<Output = Result<()>> + Send;
    fn notice_fits(&self, text: &str) -> bool;
    fn notice_chunks(&self, text: &str) -> Vec<String>;
}
