use super::{
    authority::authorize_fleet,
    values::{Connection, Fleet, FleetActor},
};
use crate::{
    identity::PrincipalKind,
    port::{Audit, AuditActor, FleetRepository},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

pub const CONTROLLER_LEASE_MS: i64 = 30_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectionView {
    pub online: bool,
    pub last_seen_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ControlView {
    pub fleet_id: String,
    pub revision: i64,
    pub delivery_enabled: bool,
    pub connection: ConnectionView,
}

pub fn connection_view(connection: Option<&Connection>, now: i64) -> ConnectionView {
    ConnectionView {
        online: connection.is_some_and(|connection| {
            connection.closed_at.is_none() && connection.expires_at > now
        }),
        last_seen_at: connection.map(|connection| connection.last_seen_at),
    }
}

pub fn control_view(fleet: &Fleet, connection: Option<&Connection>, now: i64) -> ControlView {
    ControlView {
        fleet_id: fleet.id.clone(),
        revision: fleet.revision,
        delivery_enabled: fleet.delivery_enabled,
        connection: connection_view(connection, now),
    }
}

pub fn authorized_fleet(
    repo: &mut impl FleetRepository,
    actor: &FleetActor,
    id: &str,
    write: bool,
    now: i64,
) -> Result<Fleet> {
    if matches!(actor, FleetActor::Principal(actor) if actor.kind == PrincipalKind::Agent) {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Only the fleet owner, an administrator or its controller may control this fleet",
        ));
    }
    let fleet = repo
        .fleet(id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Fleet not found"))?;
    authorize_fleet(repo, actor, &fleet, write, now)?;
    Ok(fleet)
}

pub fn change_delivery(
    repo: &mut impl FleetRepository,
    actor: &FleetActor,
    id: &str,
    expected_revision: i64,
    enabled: bool,
    request_id: &str,
    now: i64,
) -> Result<ControlView> {
    repo.transaction(|repo| {
        let mut fleet = authorized_fleet(repo, actor, id, true, now)?;
        if fleet.revision != expected_revision {
            return Err(Failure::new(
                ErrorCode::StaleRevision,
                "Refresh the fleet before changing delivery",
            ));
        }
        fleet.delivery_enabled = enabled;
        fleet.revision = fleet
            .revision
            .checked_add(1)
            .ok_or_else(|| Failure::new(ErrorCode::Conflict, "Fleet revision exhausted"))?;
        fleet.updated_at = now;
        repo.save_fleet(&fleet)?;
        let audit_actor = match actor {
            FleetActor::Principal(actor) => AuditActor::Principal(actor.clone()),
            FleetActor::Controller { credential_id, .. } => AuditActor::Controller {
                credential_id: credential_id.clone(),
            },
        };
        repo.audit(&Audit {
            actor: audit_actor,
            request_id: request_id.to_owned(),
            target_kind: "fleet".to_owned(),
            target_id: id.to_owned(),
            owner_id: Some(fleet.owner_id.clone()),
            room_id: None,
            membership_generation: None,
            authorizer_id: None,
            added_by_id: None,
            permission_code: None,
            action: if enabled {
                "fleet.delivery.activate"
            } else {
                "fleet.delivery.deactivate"
            }
            .to_owned(),
            created_at: now,
            message: String::new(),
        })?;
        Ok(control_view(
            &fleet,
            repo.fleet_connection(id)?.as_ref(),
            now,
        ))
    })
}

pub fn report_connection(
    repo: &mut impl FleetRepository,
    actor: &FleetActor,
    id: &str,
    connection_id: &str,
    stopped: bool,
    now: i64,
) -> Result<ControlView> {
    let FleetActor::Controller { credential_id, .. } = actor else {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Only this fleet controller can report its connection",
        ));
    };
    repo.transaction(|repo| {
        let fleet = authorized_fleet(repo, actor, id, false, now)?;
        let previous = repo.fleet_connection(id)?;
        if previous.as_ref().is_some_and(|current| {
            current.connection_id != connection_id
                && current.closed_at.is_none()
                && current.expires_at > now
        }) {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Another live controller owns this fleet connection",
            ));
        }
        if stopped
            && previous.as_ref().is_none_or(|current| {
                current.connection_id != connection_id || current.credential_id != *credential_id
            })
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "This controller generation does not own the connection",
            ));
        }
        if !stopped
            && previous.as_ref().is_some_and(|current| {
                current.connection_id == connection_id
                    && (current.closed_at.is_some()
                        || current.expires_at <= now
                        || current.credential_id != *credential_id)
            })
        {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Use a fresh controller connection generation",
            ));
        }
        let connection = Connection {
            fleet_id: id.to_owned(),
            connection_id: connection_id.to_owned(),
            credential_id: credential_id.clone(),
            last_seen_at: now,
            expires_at: now.checked_add(CONTROLLER_LEASE_MS).ok_or_else(|| {
                Failure::new(ErrorCode::Unavailable, "Invalid controller lease clock")
            })?,
            closed_at: stopped.then_some(now),
        };
        repo.save_fleet_connection(&connection)?;
        Ok(control_view(&fleet, Some(&connection), now))
    })
}

pub fn live_connection(
    repo: &mut impl FleetRepository,
    actor: &FleetActor,
    id: &str,
    connection_id: &str,
    now: i64,
) -> Result<(Fleet, Connection)> {
    let FleetActor::Controller { credential_id, .. } = actor else {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "A live fleet controller connection is required",
        ));
    };
    let fleet = authorized_fleet(repo, actor, id, false, now)?;
    let connection = repo
        .fleet_connection(id)?
        .filter(|connection| {
            connection.connection_id == connection_id
                && connection.credential_id == *credential_id
                && connection.closed_at.is_none()
                && connection.expires_at > now
        })
        .ok_or_else(|| {
            Failure::new(
                ErrorCode::Conflict,
                "Controller connection expired or was replaced",
            )
        })?;
    Ok((fleet, connection))
}
