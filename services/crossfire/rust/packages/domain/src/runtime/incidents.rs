use super::{port::IncidentRepository, values::*};
use crate::{identity::Status, listener::HEARTBEAT_EXPIRY_MS, matrix::MatrixAuthority};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};

pub struct NoticeContext<'a> {
    pub public_origin: &'a str,
    pub observed_iso: &'a str,
}

pub struct IncidentInput<'a> {
    pub owner_id: &'a str,
    pub agent_id: Option<&'a str>,
    pub fleet_id: Option<&'a str>,
    pub run_id: Option<&'a str>,
    pub session_id: Option<&'a str>,
    pub kind: IncidentKind,
    pub message: &'a str,
}

pub fn open(
    repo: &mut impl IncidentRepository,
    input: &IncidentInput<'_>,
    episode_id: Option<&str>,
    context: &NoticeContext<'_>,
    now: i64,
) -> Result<()> {
    let id = episode_id.map(str::to_owned).unwrap_or_else(identity::id);
    if let Some(value) = repo.incident(&id)? {
        return if value.owner_id == input.owner_id
            && value.agent_id.as_deref() == input.agent_id
            && value.fleet_id.as_deref() == input.fleet_id
            && value.run_id.as_deref() == input.run_id
            && value.session_id.as_deref() == input.session_id
            && value.kind == input.kind
            && value.message == input.message
        {
            Ok(())
        } else {
            Err(Failure::new(
                ErrorCode::Conflict,
                "Incident identity changed",
            ))
        };
    }
    if repo.active_incidents()?.iter().any(|value| {
        value.agent_id.as_deref() == input.agent_id
            && value.fleet_id.as_deref() == input.fleet_id
            && value.session_id.as_deref() == input.session_id
            && value.kind == input.kind
    }) {
        return Ok(());
    }
    let fleet = if let Some(agent_id) = input.agent_id {
        repo.fleet_instance_by_agent(agent_id)?
            .map(|binding| repo.fleet_by_key(&binding.owner_id, &binding.fleet_key))
            .transpose()?
            .flatten()
    } else {
        input
            .fleet_id
            .map(|id| repo.fleet(id))
            .transpose()?
            .flatten()
    };
    let controller_name = fleet.map(|fleet| fleet.controller_name);
    repo.insert_incident(&Incident {
        id: id.clone(),
        owner_id: input.owner_id.to_owned(),
        agent_id: input.agent_id.map(str::to_owned),
        fleet_id: input.fleet_id.map(str::to_owned),
        run_id: input.run_id.map(str::to_owned),
        session_id: input.session_id.map(str::to_owned),
        kind: input.kind,
        message: input.message.to_owned(),
        created_at: now,
        recovered_at: None,
    })?;
    let controller = controller_name.map_or_else(
        || "\nDirect connection".to_owned(),
        |name| format!("\nController: {name}"),
    );
    let path = input.agent_id.map_or_else(
        || format!("fleets/{}", input.fleet_id.unwrap_or_default()),
        |id| format!("agents/{id}/activity"),
    );
    repo.insert_notification(&Notification {
        incident_id: id,
        phase: NotificationPhase::Initial,
        body: format!(
            "{}\nObserved {}{}\n{}/manage/{}",
            input.message, context.observed_iso, controller, context.public_origin, path
        ),
        next_attempt_at: now,
        event_id: None,
    })
}

pub fn recover(
    repo: &mut impl IncidentRepository,
    agent_id: Option<&str>,
    fleet_id: Option<&str>,
    session_id: Option<&str>,
    kind: Option<IncidentKind>,
    now: i64,
) -> Result<()> {
    for value in repo.active_incidents()? {
        if value.agent_id.as_deref() != agent_id
            || value.fleet_id.as_deref() != fleet_id
            || kind.is_some_and(|kind| kind != value.kind)
            || !(value.kind == IncidentKind::Contact
                || value.session_id.is_none()
                || value.session_id.as_deref() == session_id)
        {
            continue;
        }
        repo.recover_incident(&value.id, now)?;
        let message = if value.kind == IncidentKind::Contact {
            "Contact restored."
        } else {
            "Native execution resumed."
        };
        repo.insert_notification(&Notification {
            incident_id: value.id,
            phase: NotificationPhase::Recovery,
            body: format!("{message}\n{}", value.message),
            next_attempt_at: now,
            event_id: None,
        })?;
    }
    Ok(())
}

pub fn watch(
    repo: &mut impl IncidentRepository,
    context: &NoticeContext<'_>,
    now: i64,
) -> Result<()> {
    repo.transaction(|repo| {
        for run in repo.latest_listener_runs()? {
            if run.stopped_at.is_some() || run.disconnect_requested_at.is_some() { continue; }
            if run.last_seen_at.saturating_add(HEARTBEAT_EXPIRY_MS) > now {
                recover(repo, Some(&run.agent_id), None, None, Some(IncidentKind::Contact), now)?;
                continue;
            }
            let Some(agent) = repo.agent_view(&run.agent_id)? else { continue; };
            if agent.principal.status != Status::Active || agent.owner.status != Status::Active { continue; }
            let name = repo.agent_name(&run.agent_id)?.ok_or_else(|| Failure::new(ErrorCode::Missing, "Agent name not found"))?;
            let message = format!("{name} ({}): listener contact lost. Execution state is unknown; this is not proof of a crash.", agent.owner_member.display_name);
            open(repo, &IncidentInput { owner_id: &agent.agent.owner_id, agent_id: Some(&run.agent_id), fleet_id: None,
                run_id: Some(&run.id), session_id: None, kind: IncidentKind::Contact, message: &message }, None, context, now)?;
        }
        for (fleet, connection) in repo.watched_fleets()? {
            if connection.closed_at.is_none() && connection.expires_at > now { recover(repo, None, Some(&fleet.id), None, None, now)?; }
            if connection.closed_at.is_some() || connection.expires_at > now { continue; }
            let message = format!("{}: controller contact lost. Bound listeners deactivate; native execution state is unknown.", fleet.label);
            open(repo, &IncidentInput { owner_id: &fleet.owner_id, agent_id: None, fleet_id: Some(&fleet.id), run_id: None,
                session_id: None, kind: IncidentKind::Contact, message: &message }, None, context, now)?;
        }
        Ok(())
    })
}

pub async fn publish(
    repo: &mut impl IncidentRepository,
    matrix: &impl MatrixAuthority,
    service_user: &str,
    now: impl Fn() -> Result<i64>,
    stopped: impl Fn() -> bool,
) -> Result<()> {
    let pending = repo.notifications(now()?)?;
    for mut notice in pending {
        if stopped() {
            break;
        }
        if notice.phase == NotificationPhase::Recovery
            && repo
                .notification(&notice.incident_id, NotificationPhase::Initial)?
                .is_none_or(|value| value.event_id.is_none())
        {
            continue;
        }
        let incident = repo
            .incident(&notice.incident_id)?
            .ok_or_else(|| Failure::new(ErrorCode::Missing, "Incident not found"))?;
        let Some(owner) = repo
            .principal(&incident.owner_id)?
            .filter(|owner| owner.status == Status::Active)
        else {
            continue;
        };
        let previous = repo.management_conversation(&owner.id)?;
        if previous.is_none()
            && matrix
                .set_display_name(service_user, "Crossfire")
                .await
                .is_err()
        {
            continue;
        }
        let room = matrix
            .owner_conversation(
                &owner.matrix_user_id,
                service_user,
                previous.as_ref().map(|value| value.room_id.as_str()),
                None,
            )
            .await;
        let room = match room {
            Ok(room) => room,
            Err(_) => {
                notice.next_attempt_at = now()?.saturating_add(30_000);
                repo.transaction(|repo| repo.save_notification(&notice))?;
                continue;
            }
        };
        if previous.is_none() {
            let conversation = ManagementConversation {
                owner_id: owner.id,
                room_id: room.clone(),
                created_at: now()?,
            };
            if repo
                .transaction(|repo| repo.insert_management_conversation(&conversation))
                .is_err()
            {
                continue;
            }
        }
        let transaction_id = format!("incident-{}-{}", notice.incident_id, notice.phase.code());
        let sent = matrix
            .send_notice(
                service_user,
                &room,
                &transaction_id,
                &notice.body,
                &owner.matrix_user_id,
            )
            .await;
        notice.next_attempt_at = now()?.saturating_add(30_000);
        notice.event_id = sent.ok();
        repo.transaction(|repo| repo.save_notification(&notice))?;
    }
    Ok(())
}
