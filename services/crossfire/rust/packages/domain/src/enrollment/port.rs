use super::values::{Item, Name, Request, Roster};
use crate::coordination::RequestedPolicy;
use crate::port::{DiscoveryRepository, FleetRepository};
use crossfire_kernel::Result;

pub trait RosterDigest {
    fn digest(&self, roster: &Roster) -> Result<String>;
}

pub trait EnrollmentRepository:
    crate::room_access::port::RoomRepository
    + FleetRepository
    + DiscoveryRepository
    + crate::port::CredentialRepository
{
    fn name_claim(&mut self, name: &str) -> Result<Option<Name>>;
    fn enrolled_agent_count(&mut self, owner: Option<&str>) -> Result<i64>;
    fn pending_identity_count(&mut self, owner: Option<&str>) -> Result<i64>;
    fn enrollment_request(&mut self, id: &str) -> Result<Option<Request>>;
    fn save_enrollment_request(&mut self, request: &Request, insert: bool) -> Result<()>;
    fn expired_enrollments(&mut self, now: i64) -> Result<Vec<Request>>;
    fn pending_enrollment_count(&mut self) -> Result<i64>;
    fn enrollments_page(
        &mut self,
        owner: Option<&str>,
        page: i64,
        size: i64,
    ) -> Result<crate::identity::Page<Request>>;
    fn enrollment_items(&mut self, request: &str) -> Result<Vec<Item>>;
    fn save_enrollment_item(&mut self, item: &Item, insert: bool) -> Result<()>;
    fn insert_requested_policy(&mut self, item: &Item, policy: &RequestedPolicy) -> Result<()>;
    fn requested_policies(
        &mut self,
        request: &str,
    ) -> Result<std::collections::BTreeMap<String, RequestedPolicy>>;
    fn insert_enrollment_metadata(&mut self, request: &str, key: &str, value: &str) -> Result<()>;
    fn enrollment_metadata(
        &mut self,
        request: &str,
    ) -> Result<std::collections::BTreeMap<String, String>>;
    fn save_fleet_metadata(&mut self, fleet: &str, key: &str, value: &str) -> Result<()>;
    fn save_name_claim(&mut self, name: &Name, insert: bool) -> Result<()>;
    fn remove_name(&mut self, name: &str) -> Result<()>;
    fn remove_request_names(&mut self, request: &str) -> Result<()>;
}
