mod support;
use crossfire_domain::{
    agent,
    fleet::values::FleetActor,
    identity::{PrincipalKind, Status},
    port::{AuthorizationRepository, FleetRepository},
    read::{self, port::ReadRepository, values::*},
};
use support::{NOW, Scenario};
fn pagination() -> Pagination {
    Pagination { page: 1, size: 20 }
}
#[test]
fn agent_directory_search_and_inactive_filters_match_the_reference()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let filter = AgentFilter {
        pagination: pagination(),
        owner_id: None,
        search: "AGENT",
        statuses: &[Status::Active],
        listener: None,
        agent_ids: None,
    };
    let result = read::agent::list(&mut scenario.store, &scenario.owner, &filter, NOW)?;
    assert_eq!(result.total_items, 1);
    assert_eq!(result.total_pages, 1);
    let unmatched = read::agent::list(
        &mut scenario.store,
        &scenario.owner,
        &AgentFilter {
            search: "unmatched-directory-search",
            ..filter
        },
        NOW,
    )?;
    assert_eq!(unmatched.total_items, 0);
    assert_eq!(unmatched.total_pages, 1);
    agent::change(
        &mut scenario.store,
        &scenario.owner,
        &scenario.agent.principal_id,
        0,
        Some(Status::Suspended),
        "suspend-filter",
        NOW + 1,
    )?;
    let filter = AgentFilter {
        search: "",
        statuses: &[Status::Suspended],
        listener: Some(ActivityState::Online),
        ..filter
    };
    assert_eq!(
        read::agent::list(&mut scenario.store, &scenario.owner, &filter, NOW + 1)?.total_items,
        0
    );
    let filter = AgentFilter {
        listener: Some(ActivityState::Offline),
        ..filter
    };
    assert_eq!(
        read::agent::list(&mut scenario.store, &scenario.owner, &filter, NOW + 1)?.total_items,
        1
    );
    Ok(())
}
#[test]
fn discovery_is_paginated_filtered_and_resolves_unknown_identities_without_adopting_them()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let mut database = scenario.database()?;
    assert_eq!(
        crossfire_adapter_sqlite::schema::pragma(database.connection(), "user_version")?,
        crossfire_adapter_sqlite::schema::SCHEMA_VERSION
    );
    let guest = scenario.add_human("@guest:example.test")?;
    let query = DiscoveryFilter {
        pagination: Pagination { page: 1, size: 1 },
        kind: None,
        search: "",
        exclude_id: None,
    };
    let first = read::discovery::principals(&mut scenario.store, &scenario.owner, &query, NOW)?;
    assert_eq!(first.total_items, 3);
    assert_eq!(first.total_pages, 3);
    assert_eq!(first.items.len(), 1);
    assert_eq!(first.items[0].kind, PrincipalKind::Human);
    let page = scenario.store.discover(&DiscoveryFilter {
        pagination: Pagination { page: 3, size: 1 },
        ..query
    })?;
    assert_eq!(page.items[0].principal_id, scenario.agent.principal_id);
    assert_eq!(page.items[0].display_name, "agent (owner)");
    let excluded = scenario.store.discover(&DiscoveryFilter {
        pagination: pagination(),
        exclude_id: Some(&scenario.agent.principal_id),
        ..query
    })?;
    assert_eq!(excluded.total_items, 2);
    let filtered = scenario.store.discover(&DiscoveryFilter {
        pagination: pagination(),
        kind: Some(PrincipalKind::Agent),
        search: "AGENT",
        ..query
    })?;
    assert_eq!(filtered.total_items, 1);
    let pattern = scenario.store.discover(&DiscoveryFilter {
        pagination: pagination(),
        search: "%_",
        ..query
    })?;
    assert_eq!(pattern.total_items, 3);
    let values = read::discovery::resolve(
        &mut scenario.store,
        &guest,
        &[
            "@unknown:example.test".to_owned(),
            "@agent:example.test".to_owned(),
            "@owner:example.test".to_owned(),
        ],
        NOW,
    )?;
    assert_eq!(values[0].kind, None);
    assert_eq!(values[0].owner_matrix_id, None);
    assert_eq!(
        values[1].owner_matrix_id.as_deref(),
        Some("@owner:example.test")
    );
    assert_eq!(values[1].owner_display_name.as_deref(), Some("owner"));
    assert_eq!(values[2].kind, Some(PrincipalKind::Human));
    assert_eq!(values[2].owner_matrix_id, None);
    assert!(
        scenario
            .store
            .principal_by_matrix_id("@unknown:example.test")?
            .is_none()
    );
    assert!(
        read::discovery::resolve(
            &mut scenario.store,
            &guest,
            &[
                "@owner:example.test".to_owned(),
                "@owner:example.test".to_owned()
            ],
            NOW
        )
        .is_err()
    );
    assert_eq!(
        read::discovery::roles(&mut scenario.store, &guest, NOW)?.len(),
        2
    );
    assert_eq!(
        read::discovery::permissions(&mut scenario.store, &guest, NOW)?.len(),
        crossfire_domain::permission::Permission::ALL.len()
    );
    Ok(())
}
#[test]
fn agent_and_fleet_details_use_current_controller_authority_not_stale_activity()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    let filter = AgentFilter {
        pagination: pagination(),
        owner_id: None,
        search: "",
        statuses: &[Status::Active],
        listener: Some(ActivityState::Online),
        agent_ids: None,
    };
    let page = read::agent::list(&mut scenario.store, &scenario.owner, &filter, NOW)?;
    assert_eq!(page.total_items, 1);
    assert_eq!(page.items[0].activity.status, ActivityState::Online);
    assert!(!page.items[0].can_retire);
    assert_eq!(
        page.items[0].deployment.fleet_id,
        scenario.report.controller.fleet_id
    );
    assert_eq!(
        read::agent::list(&mut scenario.store, &guest, &filter, NOW)?.total_items,
        0
    );
    assert!(
        read::agent::list(
            &mut scenario.store,
            &guest,
            &AgentFilter {
                owner_id: Some(&scenario.owner.principal_id),
                ..filter
            },
            NOW
        )
        .is_err()
    );
    let fleets = read::fleet::list(
        &mut scenario.store,
        &scenario.owner,
        None,
        "fixture",
        pagination(),
        NOW,
    )?;
    assert_eq!(fleets.total_items, 1);
    assert!(fleets.items[0].connection.online);
    assert!(!fleets.items[0].can_archive);
    assert_eq!(
        read::fleet::list(&mut scenario.store, &guest, None, "", pagination(), NOW)?.total_items,
        0
    );
    let controller = crossfire_domain::fleet::authority::authenticate_controller(
        &mut scenario.store,
        &scenario.report.controller.credential,
    )?;
    let agents = read::fleet::agents(
        &mut scenario.store,
        &controller,
        &scenario.report.controller.fleet_id,
        pagination(),
        NOW,
    )?;
    assert_eq!(agents.items[0].0, "agent");
    assert!(agents.items[0].1.allowed_actions.is_empty());
    let mut fleet = scenario
        .store
        .fleet(&scenario.report.controller.fleet_id)?
        .ok_or("Fleet")?;
    fleet.delivery_enabled = false;
    scenario.store.save_fleet(&fleet)?;
    let details = read::agent::read(
        &mut scenario.store,
        &scenario.owner,
        &scenario.agent.principal_id,
        NOW,
    )?;
    assert_eq!(details.activity.status, ActivityState::Online);
    assert_eq!(details.activity.last_seen_at, Some(NOW));
    assert_eq!(details.activity.active_runs.len(), 1);
    assert_eq!(
        read::agent::list(&mut scenario.store, &scenario.owner, &filter, NOW)?.total_items,
        1
    );
    assert_eq!(
        read::agent::list(
            &mut scenario.store,
            &scenario.owner,
            &AgentFilter {
                listener: Some(ActivityState::Offline),
                ..filter
            },
            NOW
        )?
        .total_items,
        0
    );
    let history = read::agent::history(
        &mut scenario.store,
        &scenario.owner,
        &scenario.agent.principal_id,
        pagination(),
        NOW,
    )?;
    assert_eq!(history.items[0].id, scenario.report.run_id);
    assert!(history.items[0].stopped_at.is_none());
    assert!(
        read::fleet::read(
            &mut scenario.store,
            &FleetActor::Principal(guest),
            &fleet.id,
            NOW
        )
        .is_err()
    );
    Ok(())
}
#[test]
fn audit_projections_are_owner_scoped_and_enriched_without_private_credentials()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    agent::change(
        &mut scenario.store,
        &scenario.owner,
        &scenario.agent.principal_id,
        0,
        Some(Status::Suspended),
        "audit-projection",
        NOW + 1,
    )?;
    let page = read::discovery::audits(
        &mut scenario.store,
        &scenario.owner,
        None,
        pagination(),
        NOW + 1,
    )?;
    let event = page
        .items
        .iter()
        .find(|value| value.event.request_id == "audit-projection")
        .ok_or("Audit event")?;
    assert_eq!(
        event
            .actor
            .as_ref()
            .map(|value| value.principal_id.as_str()),
        Some(scenario.owner.principal_id.as_str())
    );
    assert_eq!(
        event
            .target
            .as_ref()
            .map(|value| value.principal_id.as_str()),
        Some(scenario.agent.principal_id.as_str())
    );
    assert_eq!(event.event.actor_credential_id, None);
    assert_eq!(
        read::discovery::audits(&mut scenario.store, &guest, None, pagination(), NOW + 1)?
            .total_items,
        0
    );
    assert!(
        read::discovery::audits(
            &mut scenario.store,
            &guest,
            Some(&scenario.owner.principal_id),
            pagination(),
            NOW + 1
        )
        .is_err()
    );
    assert!(
        scenario
            .store
            .audits_page(None, Pagination { page: 0, size: 100 })
            .is_err()
    );
    assert!(
        scenario
            .store
            .agents_page(
                &AgentFilter {
                    pagination: Pagination {
                        page: i64::MAX,
                        size: 100
                    },
                    owner_id: None,
                    search: "",
                    statuses: &[Status::Active],
                    listener: None,
                    agent_ids: None
                },
                None
            )
            .is_err()
    );
    Ok(())
}
