use crate::{
    fleet::{control::ConnectionView, values::Fleet},
    identity::{AgentView, Page, PrincipalKind, PrincipalSummary, Status},
    listener::Run,
    runtime::values::Summary,
};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pagination {
    pub page: i64,
    pub size: i64,
}
impl Pagination {
    pub fn validate(self) -> crossfire_kernel::Result<Self> {
        if (1..=100000).contains(&self.page) && (1..=100).contains(&self.size) {
            Ok(self)
        } else {
            Err(crossfire_kernel::Failure::new(
                crossfire_kernel::failure::ErrorCode::Invalid,
                "Use page ≥ 1 and pageSize 1–100",
            ))
        }
    }
    pub fn offset(self) -> i64 {
        (self.page - 1) * self.size
    }
    pub fn finish<T>(self, items: Vec<T>, total: i64) -> Page<T> {
        Page {
            items,
            page: self.page,
            page_size: self.size,
            total_items: total,
            total_pages: ((total + self.size - 1) / self.size).max(1),
        }
    }
}
pub struct DiscoveryFilter<'a> {
    pub pagination: Pagination,
    pub kind: Option<PrincipalKind>,
    pub search: &'a str,
    pub exclude_id: Option<&'a str>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrincipalIdentity {
    pub matrix_user_id: String,
    pub kind: Option<PrincipalKind>,
    pub owner_matrix_id: Option<String>,
    pub display_name: Option<String>,
    pub owner_display_name: Option<String>,
}
pub struct CatalogRole {
    pub code: String,
    pub principal_kind: PrincipalKind,
    pub label: String,
}
pub struct CatalogPermission {
    pub code: String,
    pub grant_scope: String,
    pub description: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityState {
    Online,
    Offline,
    Disconnecting,
}
pub struct AgentFilter<'a> {
    pub pagination: Pagination,
    pub owner_id: Option<&'a str>,
    pub search: &'a str,
    pub statuses: &'a [Status],
    pub listener: Option<ActivityState>,
    pub agent_ids: Option<&'a [String]>,
}
pub struct AgentRecord {
    pub name: String,
    pub view: AgentView,
}
pub struct ListenerTotal {
    pub agent_id: String,
    pub active_ms: i64,
    pub messages_delivered: i64,
    pub last_seen_at: i64,
}
pub struct AdmissionCandidate {
    pub run: Run,
    pub facts: Option<crate::listener::AdmissionFacts>,
}
pub struct Activity {
    pub status: ActivityState,
    pub active_ms: i64,
    pub messages_delivered: i64,
    pub last_seen_at: Option<i64>,
    pub active_runs: Vec<Run>,
}
pub struct Deployment {
    pub agent_id: String,
    pub fleet_id: String,
    pub fleet_key: String,
    pub label: String,
    pub controller_name: String,
    pub reported_at: i64,
    pub instance_key: String,
}
pub struct AgentDetails {
    pub record: AgentRecord,
    pub activity: Activity,
    pub native_runtime: Option<Summary>,
    pub deployment: Deployment,
    pub can_retire: bool,
    pub allowed_actions: Vec<&'static str>,
}
pub struct FleetDetails {
    pub fleet: Fleet,
    pub metadata: BTreeMap<String, String>,
    pub owner: PrincipalSummary,
    pub connection: ConnectionView,
    pub can_archive: bool,
    pub allowed_actions: Vec<&'static str>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditEvent {
    pub id: String,
    pub request_id: String,
    pub actor_credential_id: Option<String>,
    pub actor_kind: String,
    pub actor_principal_id: Option<String>,
    pub owner_id: Option<String>,
    pub target_kind: String,
    pub target_id: String,
    pub room_id: Option<String>,
    pub membership_generation: Option<String>,
    pub authorizer_id: Option<String>,
    pub added_by_id: Option<String>,
    pub permission_code: Option<String>,
    pub action: String,
    pub outcome: String,
    pub message: String,
    pub created_at: i64,
}
pub struct AuditDetails {
    pub event: AuditEvent,
    pub actor: Option<PrincipalSummary>,
    pub target: Option<PrincipalSummary>,
}
