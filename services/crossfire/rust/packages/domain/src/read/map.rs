use super::{agent, fleet, port::ReadRepository, values::*};
use crate::{
    fleet::values::FleetActor,
    identity::{Actor, PrincipalSummary, Status, WakeMode},
    messaging::Membership,
    room_access::{
        port::RoomReadRepository,
        values::{Access, Application, Grant},
    },
    wake::{self, Sender},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use std::collections::{BTreeMap, BTreeSet};

pub trait MapEncoding {
    fn source(&self, mode: WakeMode, senders: &[Sender]) -> Result<String>;
    fn compare(&self, first: &str, second: &str) -> std::cmp::Ordering;
}
pub struct Source {
    pub id: String,
    pub mode: WakeMode,
    pub senders: Vec<Sender>,
    pub eligible: Vec<String>,
}
pub struct Agent {
    pub instance_key: String,
    pub record: AgentRecord,
    pub source_id: String,
    pub activity: Activity,
}
pub struct Connection {
    pub agent_id: String,
    pub room_id: String,
    pub grant: Option<Grant>,
    pub application: Option<Application>,
}
pub struct Room {
    pub id: String,
    pub observer: String,
}
pub struct Capture {
    pub fleet: FleetDetails,
    pub captured_at: i64,
    pub agents: Vec<Agent>,
    pub rooms: Vec<Room>,
    pub connections: Vec<Connection>,
    pub sources: Vec<Source>,
    pub principals: Vec<PrincipalSummary>,
}
fn limit(message: &str) -> Failure {
    Failure::new(ErrorCode::Limit, message)
}
pub fn capture(
    repo: &mut (impl ReadRepository + RoomReadRepository),
    encoding: &impl MapEncoding,
    actor: &Actor,
    id: &str,
    now: i64,
) -> Result<Capture> {
    let fleet = fleet::read(repo, &FleetActor::Principal(actor.clone()), id, now)?;
    let instances = repo.current_fleet_instances(&fleet.fleet)?;
    if instances.len() > 1000 {
        return Err(limit("Fleet map exceeds the agent limit"));
    }
    let ids: Vec<_> = instances
        .iter()
        .map(|value| value.agent_id.clone())
        .collect();
    let keys: BTreeMap<_, _> = instances
        .into_iter()
        .map(|value| (value.agent_id, value.instance_key))
        .collect();
    let mut records = Vec::with_capacity(ids.len());
    for page in 1..=(ids.len().div_ceil(100)).max(1) {
        let values = repo.agents_page(
            &AgentFilter {
                pagination: Pagination {
                    page: page as i64,
                    size: 100,
                },
                owner_id: Some(&fleet.fleet.owner_id),
                search: "",
                statuses: &[Status::Active, Status::Suspended, Status::Revoked],
                listener: None,
                agent_ids: Some(&ids),
            },
            None,
        )?;
        if values.total_items != ids.len() as i64 {
            return Err(Failure::new(
                ErrorCode::Unavailable,
                "Fleet map has an incomplete agent directory",
            ));
        }
        records.extend(values.items);
    }
    if records.len() != ids.len() {
        return Err(Failure::new(
            ErrorCode::Unavailable,
            "Fleet map has an incomplete agent directory",
        ));
    }
    let (grants, applications) = repo.relations_for_agents(&ids)?;
    let mut connections = BTreeMap::new();
    for grant in grants {
        connections.insert(
            (grant.agent_id.clone(), grant.room_id.clone()),
            Connection {
                agent_id: grant.agent_id.clone(),
                room_id: grant.room_id.clone(),
                grant: Some(grant),
                application: None,
            },
        );
    }
    for application in applications {
        let connection = connections
            .entry((application.agent_id.clone(), application.room_id.clone()))
            .or_insert_with(|| Connection {
                agent_id: application.agent_id.clone(),
                room_id: application.room_id.clone(),
                grant: None,
                application: None,
            });
        connection.application = Some(application);
    }
    let mut connections: Vec<_> = connections
        .into_values()
        .filter(|value| {
            value
                .grant
                .as_ref()
                .is_some_and(|grant| grant.intent.access != Access::None)
                || value.application.as_ref().is_some_and(|application| {
                    matches!(
                        application.membership,
                        Some(Membership::Join | Membership::Invite)
                    ) || application.error_code.is_some()
                        || application.error_message.is_some()
                })
                || value.grant.as_ref().is_some_and(|grant| {
                    value.application.as_ref().is_none_or(|application| {
                        application.applied_revision != Some(grant.revision)
                    })
                })
        })
        .collect();
    if connections.len() > 10000 {
        return Err(limit("Fleet map exceeds the connection limit"));
    }
    connections.sort_by(|first, second| {
        encoding
            .compare(&first.agent_id, &second.agent_id)
            .then_with(|| encoding.compare(&first.room_id, &second.room_id))
    });
    let mut rooms = BTreeMap::<String, &Connection>::new();
    for connection in &connections {
        let previous = rooms.get(&connection.room_id);
        if previous.is_none()
            || connection
                .application
                .as_ref()
                .is_some_and(|application| application.membership == Some(Membership::Join))
                && previous.is_some_and(|previous| {
                    previous
                        .application
                        .as_ref()
                        .is_none_or(|application| application.membership != Some(Membership::Join))
                })
        {
            rooms.insert(connection.room_id.clone(), connection);
        }
    }
    if rooms.len() > 2000 {
        return Err(limit("Fleet map exceeds the room limit"));
    }
    let mut rooms: Vec<_> = rooms
        .into_iter()
        .map(|(id, connection)| Room {
            id,
            observer: connection.agent_id.clone(),
        })
        .collect();
    rooms.sort_by(|first, second| encoding.compare(&first.id, &second.id));
    let active = repo.active_principals()?;
    let mut selections = repo.wake_senders_many(&ids)?;
    let mut sources = BTreeMap::<String, Source>::new();
    let mut source_by_agent = BTreeMap::new();
    let mut principal_ids = BTreeSet::new();
    for record in &records {
        let id = &record.view.principal.id;
        let mode = record.view.agent.wake_mode;
        let mut senders = selections.remove(id).unwrap_or_default();
        senders
            .sort_by(|first, second| encoding.compare(&first.principal_id, &second.principal_id));
        let source_id = encoding.source(mode, &senders)?;
        let source = sources.entry(source_id.clone()).or_insert_with(|| Source {
            id: source_id.clone(),
            mode,
            senders: senders.clone(),
            eligible: Vec::new(),
        });
        let mut eligible: BTreeSet<_> = source.eligible.iter().cloned().collect();
        for identity in &active {
            if wake::accepts(
                id,
                mode,
                &senders,
                &identity.principal.id,
                identity.principal.kind,
                identity.owner_id.as_deref(),
            ) {
                eligible.insert(identity.principal.id.clone());
            }
        }
        source.eligible = eligible.into_iter().collect();
        for id in source
            .senders
            .iter()
            .map(|value| &value.principal_id)
            .chain(source.eligible.iter())
        {
            principal_ids.insert(id.clone());
        }
        source_by_agent.insert(id.clone(), source_id);
    }
    if principal_ids.len() > 2000 {
        return Err(limit("Fleet map exceeds the identity limit"));
    }
    let principals = repo.selected_principals(&principal_ids.into_iter().collect::<Vec<_>>())?;
    let expected = sources
        .values()
        .flat_map(|source| {
            source
                .senders
                .iter()
                .map(|value| &value.principal_id)
                .chain(source.eligible.iter())
        })
        .collect::<BTreeSet<_>>()
        .len();
    if principals.len() != expected {
        return Err(Failure::new(
            ErrorCode::Unavailable,
            "Fleet map has an incomplete identity directory",
        ));
    }
    let mut activity = agent::activity(repo, &ids, now)?;
    let agents = records
        .into_iter()
        .map(|record| {
            let id = &record.view.principal.id;
            let missing = || {
                Failure::new(
                    ErrorCode::Unavailable,
                    "Fleet map has an incomplete agent projection",
                )
            };
            Ok(Agent {
                instance_key: keys.get(id).cloned().ok_or_else(missing)?,
                source_id: source_by_agent.remove(id).ok_or_else(missing)?,
                activity: activity.remove(id).ok_or_else(missing)?,
                record,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(Capture {
        fleet,
        captured_at: now,
        agents,
        rooms,
        connections,
        sources: sources.into_values().collect(),
        principals,
    })
}
