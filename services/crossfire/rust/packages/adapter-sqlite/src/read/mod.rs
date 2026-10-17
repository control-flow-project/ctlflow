mod agents;
mod catalog;
mod discovery;
mod fleets;
mod listeners;
use crate::store::Store;
use crossfire_domain::{
    fleet::values::{Connection, Fleet},
    identity::{Page, PrincipalKind, PrincipalSummary},
    listener::Run,
    read::{port::ReadRepository, values::*},
};
use crossfire_kernel::Result;
use std::collections::BTreeMap;
impl ReadRepository for Store {
    fn discover(&mut self, filter: &DiscoveryFilter<'_>) -> Result<Page<PrincipalSummary>> {
        discovery::page(self, filter)
    }
    fn identities(&mut self, ids: &[String]) -> Result<Vec<PrincipalIdentity>> {
        discovery::identities(self, ids)
    }
    fn wake_senders_many(
        &mut self,
        ids: &[String],
    ) -> Result<BTreeMap<String, Vec<crossfire_domain::wake::Sender>>> {
        use crate::{error::failure, tables::agent_wake_sender};
        use diesel::prelude::*;
        let rows = agent_wake_sender::table
            .filter(agent_wake_sender::agent_id.eq_any(ids))
            .select((
                agent_wake_sender::agent_id,
                agent_wake_sender::sender_principal_id,
                agent_wake_sender::include_agents,
            ))
            .order((
                agent_wake_sender::agent_id.asc(),
                agent_wake_sender::sender_principal_id.asc(),
            ))
            .load::<(String, String, i64)>(self.database.connection())
            .map_err(failure)?;
        let mut result = BTreeMap::<String, Vec<crossfire_domain::wake::Sender>>::new();
        for (agent, principal_id, include) in rows {
            let include_agents = match include {
                0 => false,
                1 => true,
                _ => {
                    return Err(crossfire_kernel::Failure::new(
                        crossfire_kernel::failure::ErrorCode::Unavailable,
                        "Invalid stored wake sender",
                    ));
                }
            };
            result
                .entry(agent)
                .or_default()
                .push(crossfire_domain::wake::Sender {
                    principal_id,
                    include_agents,
                });
        }
        Ok(result)
    }
    fn catalog_roles(&mut self, kind: PrincipalKind) -> Result<Vec<CatalogRole>> {
        catalog::roles(self, kind)
    }
    fn catalog_permissions(&mut self) -> Result<Vec<CatalogPermission>> {
        catalog::permissions(self)
    }
    fn agents_page(
        &mut self,
        filter: &AgentFilter<'_>,
        activity: Option<(&[String], bool)>,
    ) -> Result<Page<AgentRecord>> {
        agents::page(self, filter, activity)
    }
    fn deployments(&mut self, ids: &[String]) -> Result<BTreeMap<String, Deployment>> {
        fleets::deployments(self, ids)
    }
    fn listener_totals(&mut self, ids: &[String]) -> Result<Vec<ListenerTotal>> {
        listeners::totals(self, ids)
    }
    fn admission_candidates(
        &mut self,
        ids: Option<&[String]>,
        since: i64,
    ) -> Result<Vec<AdmissionCandidate>> {
        listeners::candidates(self, ids, since)
    }
    fn listener_history(&mut self, agent: &str, pagination: Pagination) -> Result<Page<Run>> {
        listeners::history(self, agent, pagination)
    }
    fn fleets_page(
        &mut self,
        owner: Option<&str>,
        search: &str,
        pagination: Pagination,
    ) -> Result<Page<Fleet>> {
        fleets::page(self, owner, search, pagination)
    }
    fn fleet_metadata_many(
        &mut self,
        ids: &[String],
    ) -> Result<BTreeMap<String, BTreeMap<String, String>>> {
        fleets::metadata(self, ids)
    }
    fn fleet_connections(&mut self, ids: &[String]) -> Result<BTreeMap<String, Connection>> {
        fleets::connections(self, ids)
    }
    fn audits_page(
        &mut self,
        owner: Option<&str>,
        pagination: Pagination,
    ) -> Result<Page<AuditEvent>> {
        catalog::audits(self, owner, pagination)
    }
}
