use super::{port::ReadRepository, values::Pagination};
use crate::{
    fleet::{authority::authorize_fleet, values::FleetActor},
    identity::{Actor, PrincipalSummary},
    logging::DAY_MS,
    statistics::Statistics,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::{BTreeMap, BTreeSet};
pub struct Report {
    pub captured_at: i64,
    pub since: i64,
    pub retention_days: i64,
    pub measured: Statistics,
    pub agents: BTreeMap<String, PrincipalSummary>,
    pub senders: BTreeMap<String, Option<String>>,
    pub pagination: Pagination,
}
pub fn read(
    repo: &mut impl ReadRepository,
    actor: &Actor,
    id: &str,
    hours: i64,
    retention_days: i64,
    pagination: Pagination,
    now: i64,
) -> Result<Report> {
    pagination.validate()?;
    if ![1, 24, 168, 720].contains(&hours)
        || retention_days < 1
        || retention_days.checked_mul(DAY_MS).is_none()
    {
        return Err(Failure::new(
            ErrorCode::Invalid,
            "Invalid statistics window or pagination",
        ));
    }
    let fleet = repo
        .fleet(id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Fleet not found"))?;
    authorize_fleet(
        repo,
        &FleetActor::Principal(actor.clone()),
        &fleet,
        false,
        now,
    )?;
    let ids: Vec<_> = repo
        .current_fleet_instances(&fleet)?
        .into_iter()
        .map(|value| value.agent_id)
        .collect();
    let since = now.saturating_sub((hours * 3600000).min(retention_days * DAY_MS));
    let agents = repo
        .selected_principals(&ids)?
        .into_iter()
        .map(|value| (value.principal_id.clone(), value))
        .collect();
    let measured = repo.statistics(&ids, since, pagination.page, pagination.size)?;
    let senders: Vec<_> = measured
        .flows
        .iter()
        .map(|value| value.flow.sender_backend_user_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let senders = repo
        .identities(&senders)?
        .into_iter()
        .map(|value| (value.backend_user_id, value.display_name))
        .collect();
    Ok(Report {
        captured_at: now,
        since,
        retention_days,
        measured,
        agents,
        senders,
        pagination,
    })
}
