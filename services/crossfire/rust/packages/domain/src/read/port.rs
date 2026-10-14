use super::values::*;
use crate::{
    fleet::{
        native_stop::RetirementRepository,
        values::{Connection, Fleet},
    },
    identity::{Page, PrincipalKind},
    listener::Run,
    port::{AgentRepository, DiscoveryRepository},
    runtime::port::ObservationRepository,
};
use crossfire_kernel::Result;
use std::collections::BTreeMap;
pub trait ReadRepository:
    DiscoveryRepository + AgentRepository + RetirementRepository + ObservationRepository
{
    fn discover(
        &mut self,
        filter: &DiscoveryFilter<'_>,
    ) -> Result<Page<crate::identity::PrincipalSummary>>;
    fn identities(&mut self, matrix_ids: &[String]) -> Result<Vec<PrincipalIdentity>>;
    fn catalog_roles(&mut self, kind: PrincipalKind) -> Result<Vec<CatalogRole>>;
    fn catalog_permissions(&mut self) -> Result<Vec<CatalogPermission>>;
    fn agents_page(
        &mut self,
        filter: &AgentFilter<'_>,
        activity: Option<(&[String], bool)>,
    ) -> Result<Page<AgentRecord>>;
    fn deployments(&mut self, ids: &[String]) -> Result<BTreeMap<String, Deployment>>;
    fn listener_totals(&mut self, ids: &[String]) -> Result<Vec<ListenerTotal>>;
    fn admission_candidates(
        &mut self,
        ids: Option<&[String]>,
        since: i64,
    ) -> Result<Vec<AdmissionCandidate>>;
    fn listener_history(&mut self, agent: &str, pagination: Pagination) -> Result<Page<Run>>;
    fn fleets_page(
        &mut self,
        owner: Option<&str>,
        search: &str,
        pagination: Pagination,
    ) -> Result<Page<Fleet>>;
    fn fleet_metadata_many(
        &mut self,
        ids: &[String],
    ) -> Result<BTreeMap<String, BTreeMap<String, String>>>;
    fn fleet_connections(&mut self, ids: &[String]) -> Result<BTreeMap<String, Connection>>;
    fn audits_page(
        &mut self,
        owner: Option<&str>,
        pagination: Pagination,
    ) -> Result<Page<AuditEvent>>;
}
