use super::values::{Fleet, FleetActor};
use crate::{
    authorization::authorize,
    identity::{PrincipalKind, Status},
    permission::Permission,
    port::FleetRepository,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};

fn permission(fleet: &Fleet, principal_id: &str, write: bool) -> Permission {
    match (fleet.owner_id == principal_id, write) {
        (true, true) => Permission::AgentConfigureOwned,
        (false, true) => Permission::AgentConfigureAny,
        (true, false) => Permission::AgentReadOwned,
        (false, false) => Permission::AgentReadAny,
    }
}

pub fn requester_authorized(
    repo: &mut impl FleetRepository,
    principal_id: &str,
    fleet: &Fleet,
) -> Result<bool> {
    let principal = repo.principal(principal_id)?;
    if principal.is_none_or(|principal| {
        principal.kind != PrincipalKind::Human || principal.status != Status::Active
    }) {
        return Ok(false);
    }
    Ok(repo
        .permissions(principal_id)?
        .iter()
        .any(|value| *value == permission(fleet, principal_id, true)))
}

pub fn controller_token(enrollment_id: &str, claim: &Secret) -> Secret {
    Secret::new(format!(
        "fleet.{enrollment_id}.{}",
        identity::hash(&format!("crossfire-controller:{}", claim.expose()))
    ))
}

pub fn authenticate_controller(
    repo: &mut impl FleetRepository,
    token: &Secret,
) -> Result<FleetActor> {
    let mut pieces = token.expose().split('.');
    let (Some("fleet"), Some(id), Some(digest), None) =
        (pieces.next(), pieces.next(), pieces.next(), pieces.next())
    else {
        return Err(Failure::new(
            ErrorCode::Unauthorized,
            "Invalid controller credential",
        ));
    };
    if id.len() != 36
        || !id
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value) || value == b'-')
        || digest.len() != 64
        || !digest
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
    {
        return Err(Failure::new(
            ErrorCode::Unauthorized,
            "Invalid controller credential",
        ));
    }
    let credential = repo
        .fleet_credential(id)?
        .filter(|value| {
            value.revoked_at.is_none() && identity::matches(token.expose(), &value.secret_hash)
        })
        .ok_or_else(|| Failure::new(ErrorCode::Unauthorized, "Invalid controller credential"))?;
    let fleet = repo
        .fleet(&credential.fleet_id)?
        .filter(|value| value.archived_at.is_none())
        .ok_or_else(|| Failure::new(ErrorCode::Unauthorized, "Fleet is unavailable"))?;
    if repo
        .principal(&fleet.owner_id)?
        .is_none_or(|owner| owner.status != Status::Active)
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Fleet owner is not active",
        ));
    }
    Ok(FleetActor::Controller {
        fleet_id: fleet.id,
        credential_id: credential.id,
    })
}

pub fn authorize_fleet(
    repo: &mut impl FleetRepository,
    actor: &FleetActor,
    fleet: &Fleet,
    write: bool,
    now: i64,
) -> Result<()> {
    if write && fleet.archived_at.is_some() {
        return Err(Failure::new(ErrorCode::Forbidden, "Fleet is archived"));
    }
    match actor {
        FleetActor::Principal(actor) => {
            authorize(
                repo,
                actor,
                permission(fleet, &actor.principal_id, write),
                now,
            )?;
            Ok(())
        }
        FleetActor::Controller {
            fleet_id,
            credential_id,
        } => {
            if fleet.archived_at.is_some() {
                return Err(Failure::new(ErrorCode::Forbidden, "Fleet is archived"));
            }
            let credential = repo.fleet_credential(credential_id)?;
            let owner = repo.principal(&fleet.owner_id)?;
            if fleet_id == &fleet.id
                && credential
                    .is_some_and(|value| value.fleet_id == fleet.id && value.revoked_at.is_none())
                && owner.is_some_and(|value| value.status == Status::Active)
            {
                Ok(())
            } else {
                Err(Failure::new(
                    ErrorCode::Forbidden,
                    "Controller authority does not cover this fleet",
                ))
            }
        }
    }
}
