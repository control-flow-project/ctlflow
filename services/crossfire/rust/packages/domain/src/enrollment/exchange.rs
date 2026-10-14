use super::{port::EnrollmentRepository, values::*};
use crate::{
    fleet::authority::controller_token,
    identity::{Status, agent_display_name},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity, secret::Secret};

pub fn exchange(
    repo: &mut impl EnrollmentRepository,
    id: &str,
    claim: &Secret,
    now: i64,
) -> Result<Exchange> {
    let request = repo
        .enrollment_request(id)?
        .filter(|request| identity::matches(claim.expose(), &request.claim_hash))
        .ok_or_else(|| Failure::new(ErrorCode::Unauthorized, "Invalid enrollment claim"))?;
    let owner = repo
        .principal(&request.owner_id)?
        .filter(|owner| owner.status == Status::Active)
        .ok_or_else(|| Failure::new(ErrorCode::Forbidden, "Owner access is no longer active"))?;
    let mut result = Exchange {
        status: request.state.as_str(),
        owner_matrix_id: owner.matrix_user_id,
        fleet: None,
        instances: Vec::new(),
    };
    if request.expires_at <= now {
        result.status = "expired";
        return Ok(result);
    }
    if request.state != State::Approved {
        return Ok(result);
    }
    let fleet = repo
        .fleet_by_key(&request.owner_id, &request.fleet_key)?
        .filter(|fleet| fleet.archived_at.is_none())
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Forbidden,
                "Fleet enrollment is no longer current",
            )
        })?;
    let credential = repo.fleet_credential(id)?;
    if credential
        .as_ref()
        .is_some_and(|credential| credential.revoked_at.is_some())
    {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "This controller enrollment has been revoked",
        ));
    }
    for item in repo.enrollment_items(id)? {
        let agent = item.agent_id.ok_or_else(|| {
            Failure::new(ErrorCode::Unavailable, "Approved identity is not assigned")
        })?;
        repo.fleet_instance_by_agent(&agent)?
            .filter(|binding| {
                binding.retired_at.is_none()
                    && binding.owner_id == fleet.owner_id
                    && binding.fleet_key == fleet.fleet_key
                    && binding.instance_key == item.instance_key
            })
            .ok_or_else(|| {
                Failure::new(
                    ErrorCode::Forbidden,
                    "Agent registration is no longer current",
                )
            })?;
        let current = repo
            .agent_view(&agent)?
            .filter(|view| {
                view.principal.status == Status::Active && view.owner.status == Status::Active
            })
            .ok_or_else(|| {
                Failure::new(ErrorCode::Forbidden, "Agent access is no longer active")
            })?;
        let credentials = repo.agent_credential(&agent)?.ok_or_else(|| {
            Failure::new(ErrorCode::Forbidden, "Agent access is no longer active")
        })?;
        if repo.agent_name(&agent)?.as_deref() != Some(&item.requested_name) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "This enrollment no longer matches the registered agent name",
            ));
        }
        let ready = credentials.access_token.is_some()
            && current.application.applied_status == Some(Status::Active)
            && current.application.error_code.is_none()
            && current.application.native_display_name.as_deref()
                == Some(
                    agent_display_name(&item.requested_name, &current.owner_member.display_name)
                        .as_str(),
                );
        result.instances.push(ExchangedInstance {
            instance_key: item.instance_key,
            name: item.requested_name,
            agent_id: agent,
            error_code: current.application.error_code,
            account: if ready {
                Some(Account {
                    matrix_user_id: current.principal.matrix_user_id,
                    access_token: credentials.access_token.ok_or_else(|| {
                        Failure::new(ErrorCode::Unavailable, "Ready agent credential is missing")
                    })?,
                    device_id: "CROSSFIRE_AGENT".to_owned(),
                })
            } else {
                None
            },
        });
    }
    result.status = if result.instances.iter().any(|item| item.account.is_none()) {
        "provisioning"
    } else {
        "ready"
    };
    result.fleet = Some((
        fleet.id,
        credential
            .filter(|credential| credential.revoked_at.is_none())
            .map(|_| controller_token(id, claim)),
    ));
    Ok(result)
}
