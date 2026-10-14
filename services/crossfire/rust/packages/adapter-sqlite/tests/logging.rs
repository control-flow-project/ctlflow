mod support;

use crossfire_adapter_sqlite::tables::*;
use crossfire_domain::{
    listener::Run,
    logging::{DAY_MS, LoggingRepository, PruneInput, Retention},
    port::{Audit, CoreRepository, ListenerRepository, UnitOfWork},
    runtime::{
        port::{DecisionRepository, IncidentRepository, ObservationRepository},
        values::*,
    },
    statistics::*,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use diesel::prelude::*;
use support::{NOW, Scenario};

const OLD: i64 = NOW - 10 * DAY_MS;

fn old_run(scenario: &mut Scenario, offset: i64) -> Result<Run> {
    let mut run = scenario
        .store
        .listener_run(&scenario.report.run_id)?
        .ok_or_else(|| Failure::new(ErrorCode::Missing, "Missing fixture run"))?;
    run.id = identity::id();
    run.started_at = OLD + offset;
    run.last_seen_at = OLD + offset;
    run.stopped_at = Some(OLD + offset);
    scenario.store.save_listener_run(&run, true)?;
    Ok(run)
}

fn decision(scenario: &Scenario, run: &Run, status: DecisionStatus) -> Decision {
    Decision {
        summary: DecisionSummary {
            header: DecisionHeader {
                id: identity::id(),
                run_id: run.id.clone(),
                runtime: Runtime::Codex,
                session_id: identity::id(),
                request_id: identity::id(),
                turn_id: "turn".to_owned(),
                item_id: "item".to_owned(),
                kind: DecisionKind::Question,
                action: "input".to_owned(),
                blocking: true,
                expires_at: None,
            },
            agent_id: scenario.agent.principal_id.clone(),
            status,
            created_at: OLD,
        },
        review: "Owner review".to_owned(),
        questions: vec![Question {
            id: "question".to_owned(),
            title: "Proceed".to_owned(),
            prompt: "Proceed?".to_owned(),
            secret: false,
            allow_text: true,
            options: vec![OptionChoice {
                id: "yes".to_owned(),
                label: "Yes".to_owned(),
                description: "Continue".to_owned(),
            }],
        }],
    }
}

fn summary() -> Batch {
    Batch {
        sequence: 1,
        started_at: OLD,
        ended_at: OLD,
        dropped: 0,
        flows: vec![Flow {
            room_id: "!room:example.test".to_owned(),
            sender_matrix_id: "@owner:example.test".to_owned(),
            message_type: "m.text".to_owned(),
            totals: Totals {
                observed: 1,
                content_bytes: 40,
                ..Totals::default()
            },
        }],
        usage: vec![Usage {
            runtime: "codex".to_owned(),
            session_id: "native-history".to_owned(),
            tokens: Tokens {
                input: 100,
                output: 10,
                total: 110,
                ..Tokens::default()
            },
        }],
    }
}

#[test]
fn retention_cascades_statistics_at_the_exact_age_boundary_and_preserves_identity_and_current_history()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    let old = old_run(&mut scenario, 0)?;
    scenario.store.transaction(|store| {
        store.record_statistics(&scenario.agent.principal_id, &old.id, &summary(), OLD)
    })?;
    scenario.store.save_observation(
        &scenario.agent.principal_id,
        &ObservationView {
            run_id: old.id.clone(),
            observation: Observation {
                session_id: "history".to_owned(),
                room_id: None,
                runtime: Runtime::Codex,
                state: State::Idle,
                observed_at: OLD,
                last_activity_at: Some(OLD),
                history_available: Some(true),
                history_mode: HistoryMode::Shared,
                max_input_bytes: INPUT_BYTES,
                settings: vec![Setting {
                    name: "model".to_owned(),
                    configured: Some("fixture-model".to_owned()),
                    effective: Some("fixture-model".to_owned()),
                }],
                error_message: None,
            },
        },
    )?;
    let mut retention = Retention::new(Some(10))?;
    retention.maintain(&mut scenario.store, NOW, 500)?;
    assert!(scenario.store.listener_run(&old.id)?.is_some());
    let ids = [scenario.agent.principal_id.clone()];
    assert_eq!(
        scenario.store.statistics(&ids, OLD, 1, 20)?.totals.observed,
        1
    );
    retention.maintain(&mut scenario.store, NOW + 1, 500)?;
    assert!(scenario.store.listener_run(&old.id)?.is_none());
    assert!(
        scenario
            .store
            .listener_run(&scenario.report.run_id)?
            .is_some()
    );
    let mut database = scenario.database()?;
    assert_eq!(
        listener_stat_flow::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    assert_eq!(
        listener_stat_usage::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    assert_eq!(
        runtime_usage_checkpoint::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    assert_eq!(
        runtime_observation::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    assert_eq!(
        runtime_setting::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    assert_eq!(
        principal::table
            .filter(principal::id.eq(&guest.principal_id))
            .count()
            .get_result::<i64>(database.connection())?,
        1
    );
    assert_eq!(
        agent_name::table
            .count()
            .get_result::<i64>(database.connection())?,
        1
    );
    assert_eq!(
        fleet_credential::table
            .count()
            .get_result::<i64>(database.connection())?,
        1
    );
    retention.maintain(&mut scenario.store, NOW + 30 * DAY_MS, 500)?;
    assert!(
        scenario
            .store
            .listener_run(&scenario.report.run_id)?
            .is_some()
    );
    Ok(())
}

#[test]
fn pending_questions_and_unsent_owner_notifications_pin_their_old_run_but_settled_records_expire()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let old = old_run(&mut scenario, 0)?;
    let pending = decision(&scenario, &old, DecisionStatus::Pending);
    let settled = decision(&scenario, &old, DecisionStatus::Responded);
    scenario.store.insert_decision(&pending)?;
    scenario.store.insert_decision(&settled)?;
    let incident = Incident {
        id: identity::id(),
        owner_id: scenario.owner.principal_id.clone(),
        agent_id: Some(scenario.agent.principal_id.clone()),
        fleet_id: None,
        run_id: Some(old.id.clone()),
        session_id: None,
        kind: IncidentKind::Contact,
        message: "Contact lost".to_owned(),
        created_at: OLD,
        recovered_at: Some(OLD),
    };
    scenario.store.insert_incident(&incident)?;
    scenario.store.insert_notification(&Notification {
        incident_id: incident.id.clone(),
        phase: NotificationPhase::Initial,
        body: "Owner notice".to_owned(),
        next_attempt_at: OLD,
        event_id: None,
    })?;
    let mut retention = Retention::new(None)?;
    retention.maintain(&mut scenario.store, NOW, 500)?;
    assert!(
        scenario
            .store
            .decision(&pending.summary.header.id)?
            .is_some()
    );
    assert!(
        scenario
            .store
            .decision(&settled.summary.header.id)?
            .is_none()
    );
    assert!(scenario.store.listener_run(&old.id)?.is_some());
    assert!(scenario.store.incident(&incident.id)?.is_some());
    scenario
        .store
        .decision_status(&pending.summary.header.id, DecisionStatus::Cancelled)?;
    let mut notice = scenario
        .store
        .notification(&incident.id, NotificationPhase::Initial)?
        .ok_or("Missing notice")?;
    notice.event_id = Some("$sent".to_owned());
    scenario.store.save_notification(&notice)?;
    retention.maintain(&mut scenario.store, NOW, 500)?;
    assert!(scenario.store.listener_run(&old.id)?.is_none());
    assert!(scenario.store.incident(&incident.id)?.is_none());
    let mut database = scenario.database()?;
    assert_eq!(
        runtime_decision_question::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    assert_eq!(
        runtime_decision_option::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    Ok(())
}

#[test]
fn keyset_cleanup_does_not_starve_records_behind_pins_and_parent_transaction_failure_restores_every_row()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let pinned = old_run(&mut scenario, 0)?;
    scenario
        .store
        .insert_decision(&decision(&scenario, &pinned, DecisionStatus::Pending))?;
    let mut old = Vec::new();
    for position in 1..12 {
        old.push(old_run(&mut scenario, position)?);
    }
    scenario.store.audit(&Audit::new(
        &scenario.owner,
        "fixture",
        "agent",
        &scenario.agent.principal_id,
        "fixture",
        Some(&scenario.owner.principal_id),
        OLD,
    ))?;
    let failed = scenario.store.transaction(|store| {
        store.prune_logging(&PruneInput {
            cutoff: NOW - 7 * DAY_MS,
            limit: 500,
            runs: None,
            operations: None,
        })?;
        Err::<(), _>(Failure::new(
            ErrorCode::Conflict,
            "Rollback expected cleanup",
        ))
    });
    assert_eq!(
        failed.err().map(|error| error.code),
        Some(ErrorCode::Conflict)
    );
    for run in &old {
        assert!(scenario.store.listener_run(&run.id)?.is_some());
    }
    let mut database = scenario.database()?;
    assert_eq!(
        audit_event::table
            .count()
            .get_result::<i64>(database.connection())?,
        1
    );
    let mut retention = Retention::new(None)?;
    let mut rounds = 0;
    let mut more = true;
    while more && rounds < 20 {
        more = retention.maintain(&mut scenario.store, NOW, 1)?.1;
        rounds += 1;
    }
    assert!(!more);
    assert!(rounds > 1);
    for run in &old {
        assert!(scenario.store.listener_run(&run.id)?.is_none());
    }
    assert!(scenario.store.listener_run(&pinned.id)?.is_some());
    assert!(
        scenario
            .store
            .listener_run(&scenario.report.run_id)?
            .is_some()
    );
    assert_eq!(
        audit_event::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    Ok(())
}

#[test]
fn current_whole_fleet_and_per_agent_stop_evidence_survives_bounded_retention()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let mut database = scenario.database()?;
    let mut retained = Vec::new();
    for agent_id in [None, Some(scenario.agent.principal_id.as_str())] {
        for index in 0..3 {
            let id = identity::id();
            diesel::insert_into(fleet_runtime_operation::table)
                .values((
                    fleet_runtime_operation::id.eq(&id),
                    fleet_runtime_operation::fleet_id.eq(&scenario.report.controller.fleet_id),
                    fleet_runtime_operation::agent_id.eq(agent_id),
                    fleet_runtime_operation::author_principal_id.eq(&scenario.owner.principal_id),
                    fleet_runtime_operation::action.eq("stop"),
                    fleet_runtime_operation::expected_revision.eq(index),
                    fleet_runtime_operation::status.eq("succeeded"),
                    fleet_runtime_operation::created_at.eq(OLD + index),
                    fleet_runtime_operation::completed_at.eq(OLD + index),
                ))
                .execute(database.connection())?;
            if index == 2 {
                retained.push(id);
            }
        }
    }
    let mut retention = Retention::new(None)?;
    let mut more = true;
    let mut rounds = 0;
    while more && rounds < 20 {
        more = retention.maintain(&mut scenario.store, NOW, 1)?.1;
        rounds += 1;
    }
    assert!(!more);
    let mut ids = fleet_runtime_operation::table
        .select(fleet_runtime_operation::id)
        .load::<String>(database.connection())?;
    ids.sort();
    retained.sort();
    assert!(ids == retained);
    assert_eq!(
        fleet_native_stop::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    Ok(())
}
