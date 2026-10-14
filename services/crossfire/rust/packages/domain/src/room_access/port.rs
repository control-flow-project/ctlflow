use super::values::*;
use crate::{port::AgentRepository, runtime::port::IncidentRepository};
use crossfire_kernel::Result;
pub trait RoomRepository: AgentRepository + IncidentRepository {
    fn room_grant(&mut self, agent: &str, room: &str) -> Result<Option<Grant>>;
    fn room_grants(&mut self, agent: &str) -> Result<Vec<Grant>>;
    fn save_room_grant(&mut self, grant: &Grant, insert: bool) -> Result<()>;
    fn room_permission(&mut self, agent: &str, room: &str) -> Result<Option<Permission>>;
    fn replace_room_permissions(
        &mut self,
        agent: &str,
        room: &str,
        permission: Option<&Permission>,
    ) -> Result<()>;
    fn room_application(&mut self, agent: &str, room: &str) -> Result<Option<Application>>;
    fn save_room_application(&mut self, application: &Application, insert: bool) -> Result<()>;
    fn owner_conversation(&mut self, agent: &str) -> Result<Option<OwnerConversation>>;
    fn owner_conversation_by_room(&mut self, room: &str) -> Result<Option<OwnerConversation>>;
    fn insert_owner_conversation(&mut self, conversation: &OwnerConversation) -> Result<()>;
    fn approved_fleet_policy(&mut self, agent: &str) -> Result<Option<ApprovedPolicy>>;
    fn approve_fleet_policy(&mut self, policy: &ApprovedPolicy) -> Result<()>;
}
pub trait RoomReadRepository: RoomRepository {
    fn grants_page(
        &mut self,
        agent: &str,
        pagination: crate::read::values::Pagination,
        rooms: Option<&[String]>,
    ) -> Result<crate::identity::Page<Grant>>;
    fn applications_for_rooms(&mut self, agent: &str, rooms: &[String])
    -> Result<Vec<Application>>;
    fn permissions_for_rooms(&mut self, agent: &str, rooms: &[String]) -> Result<Vec<Permission>>;
    fn relations_for_agents(&mut self, agents: &[String])
    -> Result<(Vec<Grant>, Vec<Application>)>;
    fn due_room_grants(&mut self, now: i64) -> Result<Vec<(String, String)>>;
}
