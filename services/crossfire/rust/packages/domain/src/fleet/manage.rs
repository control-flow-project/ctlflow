use super::{authority::authorize_fleet, values::FleetActor};
use crate::{
    port::{Audit, AuditActor},
    read::{fleet, port::ReadRepository, values::FleetDetails},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::BTreeMap;
pub trait ManageRepository: ReadRepository {
    fn replace_fleet_metadata(
        &mut self,
        fleet: &str,
        values: &BTreeMap<String, String>,
    ) -> Result<()>;
}
pub struct Change<'a> {
    pub expected_revision: i64,
    pub label: &'a str,
    pub controller_name: &'a str,
    pub metadata: &'a BTreeMap<String, String>,
}
pub fn change(
    repo: &mut impl ManageRepository,
    actor: &FleetActor,
    id: &str,
    input: Change<'_>,
    request_id: &str,
    now: i64,
) -> Result<FleetDetails> {
    let plain = |value: &str, maximum| {
        value.encode_utf16().count() <= maximum
            && !value
                .chars()
                .any(|value| value <= '\u{1f}' || value == '\u{7f}')
    };
    if input
        .label
        .trim_matches(crossfire_kernel::text::whitespace)
        .is_empty()
        || !plain(input.label, 100)
        || input.controller_name.is_empty()
        || !plain(input.controller_name, 100)
        || input.metadata.len() > 16
        || input.metadata.iter().any(|(key, value)| {
            !crate::enrollment::preflight::valid_name(key) || !plain(value, 256)
        })
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid fleet label or controller metadata",
        ));
    }
    repo.transaction(|repo| {
        let mut value = repo
            .fleet(id)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Fleet not found"))?;
        authorize_fleet(repo, actor, &value, true, now)?;
        if value.revision != input.expected_revision {
            return Err(Failure::new(
                ErrorCode::StaleRevision,
                "Fleet changed; refresh before saving",
            ));
        }
        repo.replace_fleet_metadata(id, input.metadata)?;
        value.label = input.label.to_owned();
        value.controller_name = input.controller_name.to_owned();
        value.revision = value
            .revision
            .checked_add(1)
            .ok_or_else(|| Failure::new(ErrorCode::Limit, "Fleet revision exceeds native range"))?;
        value.updated_at = now;
        repo.save_fleet(&value)?;
        repo.audit(&Audit {
            actor: match actor {
                FleetActor::Principal(actor) => AuditActor::Principal(actor.clone()),
                FleetActor::Controller { credential_id, .. } => AuditActor::Controller {
                    credential_id: credential_id.clone(),
                },
            },
            request_id: request_id.to_owned(),
            target_kind: "fleet".to_owned(),
            target_id: id.to_owned(),
            action: "fleet.configure".to_owned(),
            owner_id: Some(value.owner_id),
            created_at: now,
            message: String::new(),
            room_id: None,
            membership_generation: None,
            authorizer_id: None,
            added_by_id: None,
            permission_code: None,
        })?;
        fleet::read(repo, actor, id, now)
    })
}
