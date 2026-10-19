mod support;

use crossfire_adapter_schedule::Calculator;
use crossfire_adapter_sqlite::tables::wake_rule;
use crossfire_contracts::wake_up::{DetailsView, ScheduledView};
use crossfire_domain::{
    fleet::{authority, control},
    identity::{PrincipalKind, PrincipalRole, Role},
    listener,
    port::{CoreRepository, DiscoveryRepository, FleetRepository, ListenerRepository, UnitOfWork},
    schedule::Schedule,
    wake_up::{
        delivery, manage, read,
        values::{
            Attachment, Change, DeliveryRepository, DeliveryStatus, Input, ListFilter,
            RuleRepository,
        },
    },
};
use crossfire_kernel::{Failure, failure::ErrorCode, identity};
use diesel::prelude::*;
use support::{NOW, Scenario};

fn input(id: &str) -> Input {
    Input {
        name: "  Scheduled review  ".to_owned(),
        message: "Review pending work.\nDo not interrupt active work.".to_owned(),
        schedule: Schedule::Interval { seconds: 60 },
        enabled: true,
        agent_ids: vec![id.to_owned()],
    }
}

fn heartbeat(scenario: &mut Scenario, now: i64) -> Result<(), Box<dyn std::error::Error>> {
    let actor = authority::authenticate_controller(
        &mut scenario.store,
        &scenario.report.controller.credential,
    )?;
    let previous = scenario
        .store
        .fleet_connection(&scenario.report.controller.fleet_id)?
        .ok_or("Missing controller lease")?
        .last_seen_at;
    let mut observed = previous;
    while observed + 20_000 < now {
        observed += 20_000;
        control::report_connection(
            &mut scenario.store,
            &actor,
            &scenario.report.controller.fleet_id,
            &scenario.report.controller.connection_id,
            false,
            observed,
        )?;
        listener::report(
            &mut scenario.store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &scenario.report,
            "release-current",
            observed,
        )?;
    }
    control::report_connection(
        &mut scenario.store,
        &actor,
        &scenario.report.controller.fleet_id,
        &scenario.report.controller.connection_id,
        false,
        now,
    )?;
    listener::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report,
        "release-current",
        now,
    )?;
    Ok(())
}

fn save(
    scenario: &mut Scenario,
    id: &str,
    input: &Input,
    revision: Option<i64>,
    now: i64,
) -> Result<(), Box<dyn std::error::Error>> {
    manage::save(
        &mut scenario.store,
        &Calculator,
        &scenario.owner,
        &Change {
            rule_id: id,
            input,
            expected_revision: revision,
            request_id: "fixture",
            now,
        },
    )?;
    Ok(())
}

#[test]
fn rule_crud_is_revision_checked_idempotent_scoped_and_transactional()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let rule_id = identity::id();
    let mut input = input(&scenario.agent.principal_id);
    save(&mut scenario, &rule_id, &input, None, NOW)?;
    save(&mut scenario, &rule_id, &input, None, NOW)?;
    let details = read::read(&mut scenario.store, &scenario.owner, &rule_id, NOW)?;
    assert_eq!(details.summary.rule.name, "Scheduled review");
    assert_eq!(details.summary.agent_count, 1);
    assert_eq!(details.summary.next_due_at, Some(NOW + 60_000));
    assert_eq!(
        details.agents[0].0.principal_id,
        scenario.agent.principal_id
    );
    assert!(details.agents[0].0.display_name.starts_with("agent ("));
    let wire = serde_json::to_value(DetailsView::from(&details))?;
    assert_eq!(wire["ruleId"], rule_id);
    assert_eq!(wire["schedule"]["kind"], "interval");
    assert_eq!(wire["agents"][0]["kind"], "agent");
    assert!(wire.get("id").is_none());
    let guest = scenario.add_human("@guest:example.test")?;
    assert_eq!(
        read::read(&mut scenario.store, &guest, &rule_id, NOW)
            .err()
            .ok_or("Missing private-scope refusal")?
            .code,
        ErrorCode::Missing
    );
    let guest_page = read::list(
        &mut scenario.store,
        &guest,
        &ListFilter {
            owner_id: None,
            search: "",
            page: 1,
            page_size: 20,
        },
        NOW,
    )?;
    assert_eq!(guest_page.total_items, 0);
    input.message = "Changed".to_owned();
    assert_eq!(
        manage::save(
            &mut scenario.store,
            &Calculator,
            &scenario.owner,
            &Change {
                rule_id: &rule_id,
                input: &input,
                expected_revision: None,
                request_id: "fixture",
                now: NOW
            }
        )
        .err()
        .ok_or("Missing request identity conflict")?
        .code,
        ErrorCode::Conflict
    );
    save(&mut scenario, &rule_id, &input, Some(0), NOW + 1)?;
    let mut reopened = scenario.database()?;
    let revision: i64 = wake_rule::table
        .filter(wake_rule::id.eq(&rule_id))
        .select(wake_rule::revision)
        .first(reopened.connection())?;
    assert_eq!(revision, 1);
    assert_eq!(
        manage::remove(
            &mut scenario.store,
            &scenario.owner,
            &rule_id,
            0,
            "fixture",
            NOW
        )
        .err()
        .ok_or("Missing stale refusal")?
        .code,
        ErrorCode::StaleRevision
    );
    let mut invalid = input.clone();
    invalid.agent_ids.push(identity::id());
    assert!(
        manage::save(
            &mut scenario.store,
            &Calculator,
            &scenario.owner,
            &Change {
                rule_id: &rule_id,
                input: &invalid,
                expected_revision: Some(1),
                request_id: "fixture",
                now: NOW
            }
        )
        .is_err()
    );
    assert_eq!(
        scenario
            .store
            .wake_rule(&rule_id)?
            .ok_or("Rule was lost")?
            .revision,
        1
    );
    assert_eq!(
        scenario
            .store
            .wake_assignments(std::slice::from_ref(&rule_id))?
            .len(),
        1
    );
    let missing = read::list(
        &mut scenario.store,
        &scenario.owner,
        &ListFilter {
            owner_id: None,
            search: "unmatched-directory-search",
            page: 1,
            page_size: 1,
        },
        NOW,
    )?;
    assert_eq!(missing.total_items, 0);
    assert_eq!(missing.total_pages, 1);
    assert!(missing.items.is_empty());
    let page = read::list(
        &mut scenario.store,
        &scenario.owner,
        &ListFilter {
            owner_id: None,
            search: "SCHEDULED_REVIEW",
            page: 1,
            page_size: 1,
        },
        NOW,
    )?;
    assert_eq!(page.total_items, 1);
    assert_eq!(page.items[0].rule.id, rule_id);
    manage::remove(
        &mut scenario.store,
        &scenario.owner,
        &rule_id,
        1,
        "fixture",
        NOW,
    )?;
    assert!(scenario.store.wake_rule(&rule_id)?.is_none());
    assert!(scenario.store.wake_assignments(&[rule_id])?.is_empty());
    Ok(())
}

#[test]
fn scheduled_delivery_retains_cadence_one_pending_input_and_exact_history_receipts()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let rule_id = identity::id();
    let input = input(&scenario.agent.principal_id);
    save(&mut scenario, &rule_id, &input, None, NOW)?;
    let attachment = Attachment {
        run_id: scenario.report.run_id.clone(),
        session_id: "history-one".to_owned(),
    };
    let agent_id = scenario.agent.principal_id.clone();
    assert!(
        delivery::claim(
            &mut scenario.store,
            &Calculator,
            &scenario.agent,
            &agent_id,
            &attachment,
            NOW
        )?
        .is_none()
    );
    let late = NOW + 195_000;
    heartbeat(&mut scenario, late)?;
    let command = delivery::claim(
        &mut scenario.store,
        &Calculator,
        &scenario.agent,
        &agent_id,
        &attachment,
        late,
    )?
    .ok_or("Missing coalesced delivery")?;
    assert_eq!(command.scheduled_at, NOW + 60_000);
    assert_eq!(
        scenario.store.wake_assignments(&[rule_id])?[0].next_due_at,
        NOW + 240_000
    );
    let repeated = delivery::claim(
        &mut scenario.store,
        &Calculator,
        &scenario.agent,
        &agent_id,
        &attachment,
        late,
    )?
    .ok_or("Pending delivery was lost")?;
    assert_eq!(command, repeated);
    let other_history = Attachment {
        run_id: attachment.run_id.clone(),
        session_id: "history-two".to_owned(),
    };
    assert!(
        delivery::claim(
            &mut scenario.store,
            &Calculator,
            &scenario.agent,
            &agent_id,
            &other_history,
            late
        )?
        .is_none()
    );
    assert!(!delivery::validate(
        &mut scenario.store,
        &scenario.agent,
        &agent_id,
        &command.delivery_id,
        &other_history,
        late
    )?);
    assert_eq!(
        delivery::acknowledge(
            &mut scenario.store,
            &scenario.agent,
            &agent_id,
            &command.delivery_id,
            &other_history,
            late
        )
        .err()
        .ok_or("Missing history identity refusal")?
        .code,
        ErrorCode::Missing
    );
    assert!(delivery::acknowledge(
        &mut scenario.store,
        &scenario.agent,
        &agent_id,
        &command.delivery_id,
        &attachment,
        late
    )?);
    assert!(delivery::acknowledge(
        &mut scenario.store,
        &scenario.agent,
        &agent_id,
        &command.delivery_id,
        &attachment,
        late
    )?);
    assert!(scenario.store.pending_wake_delivery(&agent_id)?.is_none());
    let wire = serde_json::to_value(ScheduledView(&command))?;
    assert_eq!(wire["sessionId"], "history-one");
    assert_eq!(wire["ownerBackendUserId"], "@owner:example.test");
    assert!(wire.get("runId").is_none());
    Ok(())
}

#[test]
fn pending_input_transfers_only_after_old_run_stops_and_only_in_the_same_history()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let rule_id = identity::id();
    let input = input(&scenario.agent.principal_id);
    save(&mut scenario, &rule_id, &input, None, NOW)?;
    heartbeat(&mut scenario, NOW + 60_000)?;
    let agent_id = scenario.agent.principal_id.clone();
    let previous = Attachment {
        run_id: scenario.report.run_id.clone(),
        session_id: "saved-history".to_owned(),
    };
    let command = delivery::claim(
        &mut scenario.store,
        &Calculator,
        &scenario.agent,
        &agent_id,
        &previous,
        NOW + 60_000,
    )?
    .ok_or("Missing first delivery")?;
    let old_run = scenario.report.run_id.clone();
    scenario.report.run_id = identity::id();
    heartbeat(&mut scenario, NOW + 60_001)?;
    let current = Attachment {
        run_id: scenario.report.run_id.clone(),
        session_id: previous.session_id.clone(),
    };
    assert!(
        delivery::claim(
            &mut scenario.store,
            &Calculator,
            &scenario.agent,
            &agent_id,
            &current,
            NOW + 60_001
        )?
        .is_none()
    );
    let mut run = scenario
        .store
        .listener_run(&old_run)?
        .ok_or("Missing older run")?;
    run.stopped_at = Some(NOW + 60_002);
    scenario.store.save_listener_run(&run, false)?;
    let resumed = delivery::claim(
        &mut scenario.store,
        &Calculator,
        &scenario.agent,
        &agent_id,
        &current,
        NOW + 60_002,
    )?
    .ok_or("Pending input was not recovered")?;
    assert_eq!(resumed.delivery_id, command.delivery_id);
    assert_eq!(resumed.session_id, "saved-history");
    assert_eq!(
        scenario
            .store
            .wake_delivery(&command.delivery_id)?
            .ok_or("Missing delivery")?
            .run_id,
        current.run_id
    );
    assert!(delivery::acknowledge(
        &mut scenario.store,
        &scenario.agent,
        &agent_id,
        &command.delivery_id,
        &current,
        NOW + 60_002
    )?);
    Ok(())
}

#[test]
fn lost_configurer_authority_fences_delivery_without_consuming_unrelated_history()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let administrator = scenario.add_human("@admin:example.test")?;
    let mut role = PrincipalRole {
        principal_id: administrator.principal_id.clone(),
        principal_kind: PrincipalKind::Human,
        role: Role::Administrator,
        assigned_by_member_id: Some(scenario.owner.principal_id.clone()),
        assigned_at: NOW,
    };
    scenario.store.save_role(&role)?;
    let rule_id = identity::id();
    let input = input(&scenario.agent.principal_id);
    manage::save(
        &mut scenario.store,
        &Calculator,
        &administrator,
        &Change {
            rule_id: &rule_id,
            input: &input,
            expected_revision: None,
            request_id: "fixture",
            now: NOW,
        },
    )?;
    role.role = Role::Member;
    scenario.store.save_role(&role)?;
    heartbeat(&mut scenario, NOW + 60_000)?;
    let input = Attachment {
        run_id: scenario.report.run_id.clone(),
        session_id: "history".to_owned(),
    };
    assert!(
        delivery::claim(
            &mut scenario.store,
            &Calculator,
            &scenario.agent,
            &scenario.agent.principal_id,
            &input,
            NOW + 60_000
        )?
        .is_none()
    );
    assert!(
        scenario
            .store
            .pending_wake_delivery(&scenario.agent.principal_id)?
            .is_none()
    );
    assert_eq!(
        scenario.store.wake_assignments(&[rule_id])?[0].next_due_at,
        NOW + 120_000
    );
    Ok(())
}

#[test]
fn changed_rule_cancels_future_admission_but_records_an_already_received_exact_message()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let rule_id = identity::id();
    let mut input = input(&scenario.agent.principal_id);
    save(&mut scenario, &rule_id, &input, None, NOW)?;
    heartbeat(&mut scenario, NOW + 60_000)?;
    let attachment = Attachment {
        run_id: scenario.report.run_id.clone(),
        session_id: "history".to_owned(),
    };
    let command = delivery::claim(
        &mut scenario.store,
        &Calculator,
        &scenario.agent,
        &scenario.agent.principal_id,
        &attachment,
        NOW + 60_000,
    )?
    .ok_or("Missing delivery")?;
    input.enabled = false;
    save(&mut scenario, &rule_id, &input, Some(0), NOW + 60_001)?;
    assert_eq!(
        scenario
            .store
            .wake_delivery(&command.delivery_id)?
            .ok_or("Missing cancellation")?
            .status,
        DeliveryStatus::Cancelled
    );
    assert!(!delivery::validate(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &command.delivery_id,
        &attachment,
        NOW + 60_001
    )?);
    assert!(delivery::acknowledge(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &command.delivery_id,
        &attachment,
        NOW + 60_002
    )?);
    assert_eq!(
        scenario.store.wake_assignments(&[rule_id])?[0].last_delivered_at,
        Some(NOW + 60_002)
    );
    assert!(
        delivery::metadata(
            &mut scenario.store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &attachment,
            NOW + 60_002
        )?
        .next_due_at
        .is_none()
    );
    Ok(())
}

#[test]
fn wake_state_and_assignments_roll_back_together_on_expected_failure()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let id = identity::id();
    let input = input(&scenario.agent.principal_id);
    let outcome: crossfire_kernel::Result<()> = scenario.store.transaction(|store| {
        manage::save(
            store,
            &Calculator,
            &scenario.owner,
            &Change {
                rule_id: &id,
                input: &input,
                expected_revision: None,
                request_id: "fixture",
                now: NOW,
            },
        )?;
        Err(Failure::new(ErrorCode::Conflict, "Abort this operation"))
    });
    assert!(outcome.is_err());
    assert!(scenario.store.wake_rule(&id)?.is_none());
    assert!(scenario.store.wake_assignments(&[id])?.is_empty());
    let values = scenario.store.selected_principals(&[
        scenario.owner.principal_id.clone(),
        scenario.agent.principal_id.clone(),
    ])?;
    assert_eq!(values.len(), 2);
    Ok(())
}
