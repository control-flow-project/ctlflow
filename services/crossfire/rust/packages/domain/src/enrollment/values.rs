use crate::coordination::{Policy, RequestedPolicy};
use crossfire_kernel::secret::Secret;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct IdentityProof {
    pub agent_id: String,
    pub access_token: Secret,
}
#[derive(Debug, Clone)]
pub struct Entry {
    pub instance_key: String,
    pub name: String,
    pub identity: Option<IdentityProof>,
    pub policy: Policy,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Controller {
    pub name: String,
    pub metadata: BTreeMap<String, String>,
}
#[derive(Debug, Clone)]
pub struct Roster {
    pub controller: Controller,
    pub controller_credential: Option<Secret>,
    pub owner_backend_user_id: String,
    pub fleet_key: String,
    pub instances: Vec<Entry>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Name {
    pub name: String,
    pub request_id: Option<String>,
    pub instance_key: Option<String>,
    pub agent_id: Option<String>,
}
#[derive(Debug, Clone)]
pub struct Existing {
    pub instance_key: String,
    pub agent_id: String,
    pub name: String,
    pub revision: i64,
    pub retired: bool,
    pub operational: bool,
}
#[derive(Debug, Clone)]
pub struct Verified {
    pub owner_id: String,
    pub owner_revision: i64,
    pub existing: Vec<Existing>,
    pub policies: BTreeMap<String, RequestedPolicy>,
}
pub struct Capacity {
    pub policy: crate::policy::InstancePolicy,
    pub owner_limit: i64,
    pub owner_count: i64,
    pub instance_count: i64,
    pub remaining: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Pending,
    Approved,
    Rejected,
    Expired,
}
impl State {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
            Self::Expired => "expired",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Request {
    pub controller_name: String,
    pub controller_credential_hash: String,
    pub id: String,
    pub owner_id: String,
    pub fleet_key: String,
    pub verification_code: String,
    pub claim_hash: String,
    pub roster_digest: String,
    pub state: State,
    pub revision: i64,
    pub created_at: i64,
    pub expires_at: i64,
    pub decided_by_member_id: Option<String>,
    pub decided_at: Option<i64>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Existing,
    Claimed,
}
impl Outcome {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Existing => "existing",
            Self::Claimed => "claimed",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub request_id: String,
    pub instance_key: String,
    pub requested_name: String,
    pub outcome: Outcome,
    pub agent_id: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemView {
    pub item: Item,
    pub current_name: Option<String>,
    pub policy: Policy,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Receipt {
    pub request: Request,
    pub owner: crate::identity::PrincipalSummary,
    pub instances: Vec<ItemView>,
}
pub struct Introduction {
    pub enrollment_id: String,
    pub claim_secret: Secret,
    pub roster: Roster,
}
pub struct Decision {
    pub expected_revision: i64,
    pub approve: bool,
    pub verification_code: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionResult {
    pub enrollment_id: String,
    pub state: State,
    pub revision: i64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExchangedInstance {
    pub instance_key: String,
    pub name: String,
    pub agent_id: String,
    pub error_code: Option<String>,
    pub account: Option<crate::messaging::Account>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Exchange {
    pub status: &'static str,
    pub owner_backend_user_id: String,
    pub fleet: Option<(String, Option<Secret>)>,
    pub instances: Vec<ExchangedInstance>,
}
