use crate::tables::{enrollment_item, enrollment_request};
use crossfire_domain::enrollment::values::{Item, Outcome, Request, State};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use diesel::prelude::*;
#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = enrollment_request, treat_none_as_null = true)]
pub(super) struct RequestRow {
    controller_name: String,
    controller_credential_hash: String,
    id: String,
    owner_id: String,
    fleet_key: String,
    verification_code: String,
    claim_hash: String,
    roster_digest: String,
    status: String,
    revision: i64,
    created_at: i64,
    expires_at: i64,
    decided_by_member_id: Option<String>,
    decided_at: Option<i64>,
}
impl From<&Request> for RequestRow {
    fn from(value: &Request) -> Self {
        Self {
            controller_name: value.controller_name.clone(),
            controller_credential_hash: value.controller_credential_hash.clone(),
            id: value.id.clone(),
            owner_id: value.owner_id.clone(),
            fleet_key: value.fleet_key.clone(),
            verification_code: value.verification_code.clone(),
            claim_hash: value.claim_hash.clone(),
            roster_digest: value.roster_digest.clone(),
            status: value.state.as_str().to_owned(),
            revision: value.revision,
            created_at: value.created_at,
            expires_at: value.expires_at,
            decided_by_member_id: value.decided_by_member_id.clone(),
            decided_at: value.decided_at,
        }
    }
}
impl TryFrom<RequestRow> for Request {
    type Error = Failure;
    fn try_from(row: RequestRow) -> Result<Self> {
        let state = match row.status.as_str() {
            "pending" => State::Pending,
            "approved" => State::Approved,
            "rejected" => State::Rejected,
            "expired" => State::Expired,
            _ => return Err(corrupt()),
        };
        Ok(Self {
            controller_name: row.controller_name,
            controller_credential_hash: row.controller_credential_hash,
            id: row.id,
            owner_id: row.owner_id,
            fleet_key: row.fleet_key,
            verification_code: row.verification_code,
            claim_hash: row.claim_hash,
            roster_digest: row.roster_digest,
            state,
            revision: row.revision,
            created_at: row.created_at,
            expires_at: row.expires_at,
            decided_by_member_id: row.decided_by_member_id,
            decided_at: row.decided_at,
        })
    }
}
#[derive(Queryable, Selectable, Insertable, AsChangeset)]
#[diesel(table_name = enrollment_item, treat_none_as_null = true)]
pub(super) struct ItemRow {
    request_id: String,
    instance_key: String,
    requested_name: String,
    outcome: String,
    agent_id: Option<String>,
}
impl From<&Item> for ItemRow {
    fn from(value: &Item) -> Self {
        Self {
            request_id: value.request_id.clone(),
            instance_key: value.instance_key.clone(),
            requested_name: value.requested_name.clone(),
            outcome: value.outcome.as_str().to_owned(),
            agent_id: value.agent_id.clone(),
        }
    }
}
impl TryFrom<ItemRow> for Item {
    type Error = Failure;
    fn try_from(row: ItemRow) -> Result<Self> {
        let outcome = match row.outcome.as_str() {
            "existing" => Outcome::Existing,
            "claimed" => Outcome::Claimed,
            _ => return Err(corrupt()),
        };
        Ok(Self {
            request_id: row.request_id,
            instance_key: row.instance_key,
            requested_name: row.requested_name,
            outcome,
            agent_id: row.agent_id,
        })
    }
}
fn corrupt() -> Failure {
    Failure::new(ErrorCode::Unavailable, "Invalid stored enrollment state")
}
