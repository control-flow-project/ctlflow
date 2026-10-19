use crossfire_domain::{messaging::*, port::BackendUserIdentity, room_access::values::Intent};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, secret::Secret};
use serde_json::{Map, Value};

pub struct Fixture;
fn unexpected<T>() -> Result<T> {
    Err(Failure::new(
        ErrorCode::Invalid,
        "Unexpected messaging operation in persistence fixture",
    ))
}
impl BackendUserIdentity for Fixture {
    async fn identify(&self, _token: &Secret) -> Result<String> {
        unexpected()
    }
}
impl MessagingAuthority for Fixture {
    fn describe(&self, origin: &str) -> BackendDescription {
        BackendDescription {
            backend_type: "fixture".to_owned(),
            label: "Test channel".to_owned(),
            chat_url: format!("{origin}/chat"),
            signup_url: format!("{origin}/signup"),
            signup_instructions: vec![],
            configuration: BackendConfiguration {
                backend_type: "fixture".to_owned(),
                parameters: Map::new(),
            },
        }
    }
    async fn authenticate(&self, _username: &str, _password: &Secret) -> Result<Secret> {
        unexpected()
    }
    fn agent_account(&self, user: &str, access_token: Secret) -> Account {
        Account {
            user_id: user.to_owned(),
            access_token,
            native: Map::new(),
        }
    }
    fn agent_user_id(&self, id: &str) -> String {
        format!("agent/{id}")
    }
    fn service_user_id(&self) -> &str {
        "service/test"
    }
    fn local_label(&self, user: &str) -> Result<String> {
        Ok(user.to_owned())
    }
    fn registration_user_id(
        &self,
        username: &str,
        _password: &Secret,
        _native: &Map<String, Value>,
    ) -> Result<String> {
        Ok(username.to_owned())
    }
    async fn exists(&self, _user: &str) -> Result<bool> {
        unexpected()
    }
    async fn provision(
        &self,
        _user: &str,
        _password: &Secret,
        _native: &Map<String, Value>,
    ) -> Result<Account> {
        unexpected()
    }
    async fn deactivate(&self, _user: &str) -> Result<()> {
        unexpected()
    }
    async fn discard(&self, _user: &str) -> Result<()> {
        unexpected()
    }
    async fn profile_name(&self, _user: &str) -> Result<Option<String>> {
        unexpected()
    }
    async fn set_display_name(&self, _user: &str, _name: &str) -> Result<()> {
        unexpected()
    }
    async fn joined(&self, _user: &str) -> Result<Vec<String>> {
        unexpected()
    }
    async fn owner_conversation(
        &self,
        _owner: &str,
        _agent: &str,
        _selected: Option<&str>,
        _previous: Option<&str>,
    ) -> Result<String> {
        unexpected()
    }
    async fn verify_owner_conversation(
        &self,
        _owner: &str,
        _agent: &str,
        _room: &str,
    ) -> Result<()> {
        unexpected()
    }
    async fn mark_direct(&self, _user: &str, _counterpart: &str, _room: &str) -> Result<()> {
        unexpected()
    }
    async fn room(&self, _user: &str, _room: &str, _subject: Option<&str>) -> Result<RoomFacts> {
        unexpected()
    }
    async fn membership(&self, _user: &str, _target: &str, _room: &str) -> Result<RoomMembership> {
        unexpected()
    }
    async fn invitation(&self, _user: &str, _room: &str) -> Result<Option<RoomInvitation>> {
        unexpected()
    }
    async fn set_room_access(
        &self,
        _user: &str,
        _target: &str,
        _room: &str,
        _access: &Intent,
        _admission: Option<&RoomAdmission>,
    ) -> Result<RoomMembership> {
        unexpected()
    }
    async fn authorize_room_access(
        &self,
        _user: &str,
        _target: &str,
        _room: &str,
        _access: &Intent,
    ) -> Result<RoomFacts> {
        unexpected()
    }
    async fn leave(&self, _user: &str, _room: &str) -> Result<()> {
        unexpected()
    }
    async fn event(&self, _user: &str, _room: &str, _event: &str) -> Result<BackendEvent> {
        unexpected()
    }
    async fn send_notice(
        &self,
        _user: &str,
        _room: &str,
        _transaction: &str,
        _body: &str,
        _sender: &str,
    ) -> Result<String> {
        unexpected()
    }
    fn close(&self) {}
}
