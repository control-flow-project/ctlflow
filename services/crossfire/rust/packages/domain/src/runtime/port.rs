use super::values::*;
use crate::{
    identity::Page,
    port::{AgentRepository, ListenerRepository},
};
use crossfire_kernel::Result;

pub trait DecisionRepository: AgentRepository + ListenerRepository {
    fn decision(&mut self, id: &str) -> Result<Option<Decision>>;
    fn decisions(
        &mut self,
        agent_id: &str,
        page: i64,
        page_size: i64,
        status: Option<DecisionStatus>,
    ) -> Result<Page<DecisionSummary>>;
    fn pending_decisions(&mut self) -> Result<Vec<DecisionSummary>>;
    fn insert_decision(&mut self, value: &Decision) -> Result<()>;
    fn decision_status(&mut self, id: &str, status: DecisionStatus) -> Result<()>;
    fn answers(&mut self, id: &str) -> Result<Vec<Answer>>;
    fn answer(&mut self, id: &str, values: &[Answer]) -> Result<()>;
}

pub trait ObservationRepository:
    DecisionRepository + IncidentRepository + crate::fleet::native_stop::NativeStopRepository
{
    fn native_summaries(
        &mut self,
        agent_ids: &[String],
    ) -> Result<std::collections::BTreeMap<String, Summary>>;
    fn observations(&mut self, agent_id: &str) -> Result<Vec<ObservationView>>;
    fn save_observation(&mut self, agent_id: &str, value: &ObservationView) -> Result<()>;
}

pub trait IncidentRepository: AgentRepository + ListenerRepository {
    fn incident(&mut self, id: &str) -> Result<Option<Incident>>;
    fn active_incidents(&mut self) -> Result<Vec<Incident>>;
    fn insert_incident(&mut self, value: &Incident) -> Result<()>;
    fn recover_incident(&mut self, id: &str, now: i64) -> Result<()>;
    fn notifications(&mut self, now: i64) -> Result<Vec<Notification>>;
    fn notification(
        &mut self,
        incident_id: &str,
        phase: NotificationPhase,
    ) -> Result<Option<Notification>>;
    fn insert_notification(&mut self, value: &Notification) -> Result<()>;
    fn save_notification(&mut self, value: &Notification) -> Result<()>;
    fn management_conversation(&mut self, owner_id: &str)
    -> Result<Option<ManagementConversation>>;
    fn management_conversation_by_room(
        &mut self,
        room_id: &str,
    ) -> Result<Option<ManagementConversation>>;
    fn insert_management_conversation(&mut self, value: &ManagementConversation) -> Result<()>;
    fn latest_listener_runs(&mut self) -> Result<Vec<crate::listener::Run>>;
    fn watched_fleets(
        &mut self,
    ) -> Result<
        Vec<(
            crate::fleet::values::Fleet,
            crate::fleet::values::Connection,
        )>,
    >;
}
