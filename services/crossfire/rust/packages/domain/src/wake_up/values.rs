use crate::{
    identity::{Page, PrincipalSummary},
    port::{AgentRepository, DiscoveryRepository, ListenerRepository},
    schedule::Schedule,
};
use crossfire_kernel::Result;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
    pub id: String,
    pub owner_id: String,
    pub configured_by_id: String,
    pub name: String,
    pub message: String,
    pub schedule: Schedule,
    pub enabled: bool,
    pub revision: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assignment {
    pub rule_id: String,
    pub agent_id: String,
    pub next_due_at: i64,
    pub last_delivered_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryStatus {
    Pending,
    Delivered,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Delivery {
    pub id: String,
    pub rule_id: String,
    pub agent_id: String,
    pub rule_revision: i64,
    pub run_id: String,
    pub session_id: String,
    pub scheduled_at: i64,
    pub created_at: i64,
    pub status: DeliveryStatus,
    pub delivered_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Input {
    pub name: String,
    pub message: String,
    pub schedule: Schedule,
    pub enabled: bool,
    pub agent_ids: Vec<String>,
}

pub struct Change<'a> {
    pub rule_id: &'a str,
    pub input: &'a Input,
    pub expected_revision: Option<i64>,
    pub request_id: &'a str,
    pub now: i64,
}

pub struct ListFilter<'a> {
    pub owner_id: Option<&'a str>,
    pub search: &'a str,
    pub page: i64,
    pub page_size: i64,
}

pub struct Summary {
    pub rule: Rule,
    pub owner: PrincipalSummary,
    pub agent_count: usize,
    pub next_due_at: Option<i64>,
    pub last_delivered_at: Option<i64>,
}

pub struct Details {
    pub summary: Summary,
    pub agents: Vec<(PrincipalSummary, Assignment)>,
}

pub struct Attachment {
    pub run_id: String,
    pub session_id: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ScheduledWake {
    pub delivery_id: String,
    pub rule_id: String,
    pub rule_revision: i64,
    pub name: String,
    pub message: String,
    pub scheduled_at: i64,
    pub session_id: String,
    pub owner_backend_user_id: String,
    pub authorizer_backend_user_id: String,
}

pub struct Metadata {
    pub now: i64,
    pub next_due_at: Option<i64>,
}

pub trait RuleRepository: AgentRepository + DiscoveryRepository {
    fn wake_rule(&mut self, id: &str) -> Result<Option<Rule>>;
    fn save_wake_rule(&mut self, rule: &Rule, insert: bool) -> Result<()>;
    fn remove_wake_rule(&mut self, id: &str) -> Result<()>;
    fn wake_rules_page(
        &mut self,
        owner_id: Option<&str>,
        search: &str,
        page: i64,
        size: i64,
    ) -> Result<Page<Rule>>;
    fn wake_assignments(&mut self, rule_ids: &[String]) -> Result<Vec<Assignment>>;
    fn save_wake_assignment(&mut self, value: &Assignment) -> Result<()>;
    fn remove_wake_assignment(&mut self, rule_id: &str, agent_id: &str) -> Result<()>;
    fn cancel_wake_deliveries(&mut self, rule_id: &str) -> Result<()>;
}

pub trait DeliveryRepository: RuleRepository + ListenerRepository {
    fn wake_delivery(&mut self, id: &str) -> Result<Option<Delivery>>;
    fn pending_wake_delivery(&mut self, agent_id: &str) -> Result<Option<Delivery>>;
    fn save_wake_delivery(&mut self, value: &Delivery, insert: bool) -> Result<()>;
    fn due_wake_assignments(&mut self, agent_id: &str, now: i64)
    -> Result<Vec<(Rule, Assignment)>>;
    fn next_wake_due_at(&mut self, agent_id: &str) -> Result<Option<i64>>;
}
