mod support;

use crossfire_adapter_sqlite::tables::{audit_event, runtime_decision_question};
use crossfire_domain::{
    port::UnitOfWork,
    runtime::{
        decisions,
        incidents::{self, IncidentInput, NoticeContext},
        observations,
        port::{DecisionRepository, IncidentRepository},
        values::*,
    },
};
use crossfire_kernel::{Failure, failure::ErrorCode, identity};
use diesel::prelude::*;
use support::{NOW, Scenario};

fn request(run: &str) -> DecisionRequest {
    DecisionRequest {
        header: DecisionHeader {
            id: identity::id(),
            run_id: run.to_owned(),
            runtime: Runtime::Codex,
            session_id: "native-session".to_owned(),
            request_id: identity::id(),
            turn_id: "native-turn".to_owned(),
            item_id: "native-item".to_owned(),
            kind: DecisionKind::Question,
            action: "input".to_owned(),
            blocking: true,
            expires_at: None,
        },
        review: "Private original request".to_owned(),
        questions: vec![Question {
            id: "question".to_owned(),
            title: "Choose".to_owned(),
            prompt: "Continue?".to_owned(),
            secret: false,
            allow_text: true,
            options: vec![OptionChoice {
                id: "yes".to_owned(),
                label: "Yes".to_owned(),
                description: "Proceed".to_owned(),
            }],
        }],
    }
}

fn observation() -> Observation {
    Observation {
        session_id: "native-session".to_owned(),
        room_id: None,
        runtime: Runtime::Codex,
        state: State::Working,
        observed_at: NOW,
        last_activity_at: Some(NOW),
        history_available: Some(true),
        history_mode: HistoryMode::Shared,
        max_input_bytes: INPUT_BYTES,
        settings: vec![Setting {
            name: "model".to_owned(),
            configured: Some("model".to_owned()),
            effective: Some("model".to_owned()),
        }],
        error_message: None,
    }
}

fn context() -> NoticeContext<'static> {
    NoticeContext {
        public_origin: "https://example.test",
        observed_iso: "2026-10-14T00:00:00.000Z",
    }
}

#[test]
fn native_questions_are_idempotent_owner_only_and_answers_are_erased_after_receipt()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let input = request(&scenario.report.run_id);
    let agent_id = &scenario.agent.principal_id;
    let initial = decisions::create(&mut scenario.store, &scenario.agent, agent_id, &input, NOW)?;
    assert_eq!(initial.summary.status, DecisionStatus::Pending);
    let retry = decisions::create(
        &mut scenario.store,
        &scenario.agent,
        agent_id,
        &input,
        NOW + 1,
    )?;
    assert!(initial == retry);
    let mut conflicting = input.clone();
    conflicting.review.push('x');
    assert_eq!(
        decisions::create(
            &mut scenario.store,
            &scenario.agent,
            agent_id,
            &conflicting,
            NOW
        )
        .err()
        .map(|error| error.code),
        Some(ErrorCode::Conflict)
    );
    let guest = scenario.add_human("@guest:example.test")?;
    let agent_id = &scenario.agent.principal_id;
    let answer = Answer {
        question_id: "question".to_owned(),
        option_id: None,
        text: Some("private answer".to_owned()),
    };
    assert!(
        decisions::answer(
            &mut scenario.store,
            &guest,
            agent_id,
            &input.header.id,
            std::slice::from_ref(&answer),
            "guest",
            NOW
        )
        .is_err()
    );
    assert!(
        decisions::receipt(
            &mut scenario.store,
            &scenario.agent,
            agent_id,
            &input.header.id,
            DecisionStatus::Responded,
            NOW
        )
        .is_err()
    );
    assert!(
        decisions::answer(
            &mut scenario.store,
            &scenario.owner,
            agent_id,
            &input.header.id,
            &[],
            "missing",
            NOW
        )
        .is_err()
    );
    decisions::answer(
        &mut scenario.store,
        &scenario.owner,
        agent_id,
        &input.header.id,
        std::slice::from_ref(&answer),
        "answer",
        NOW,
    )?;
    let (status, answers) = decisions::poll(
        &mut scenario.store,
        &scenario.agent,
        agent_id,
        &input.header.id,
        NOW,
    )?;
    assert_eq!(status, DecisionStatus::Answered);
    assert!(answers == [answer]);
    assert!(
        decisions::answer(
            &mut scenario.store,
            &scenario.owner,
            agent_id,
            &input.header.id,
            &answers,
            "duplicate",
            NOW
        )
        .is_err()
    );
    let mut database = scenario.database()?;
    let events = audit_event::table
        .filter(audit_event::target_id.eq(&input.header.id))
        .select(audit_event::message)
        .load::<String>(database.connection())?;
    assert_eq!(events.len(), 1);
    assert!(!events[0].contains("private answer"));
    decisions::receipt(
        &mut scenario.store,
        &scenario.agent,
        agent_id,
        &input.header.id,
        DecisionStatus::Responded,
        NOW,
    )?;
    assert!(scenario.store.answers(&input.header.id)?.is_empty());
    assert!(decisions::receipt(
        &mut scenario.store,
        &scenario.agent,
        agent_id,
        &input.header.id,
        DecisionStatus::Responded,
        NOW
    )?);
    assert!(!decisions::receipt(
        &mut scenario.store,
        &scenario.agent,
        agent_id,
        &identity::id(),
        DecisionStatus::Cancelled,
        NOW
    )?);
    Ok(())
}

#[test]
fn expiration_and_controller_loss_never_deliver_stale_answers()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let mut input = request(&scenario.report.run_id);
    input.header.expires_at = Some(NOW + 10);
    decisions::create(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &input,
        NOW,
    )?;
    let answer = Answer {
        question_id: "question".to_owned(),
        option_id: Some("yes".to_owned()),
        text: None,
    };
    decisions::answer(
        &mut scenario.store,
        &scenario.owner,
        &scenario.agent.principal_id,
        &input.header.id,
        &[answer],
        "answer",
        NOW,
    )?;
    let (state, answers) = decisions::poll(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &input.header.id,
        NOW + 10,
    )?;
    assert_eq!(state, DecisionStatus::Expired);
    assert!(answers.is_empty());
    decisions::expire(&mut scenario.store, NOW + 10)?;
    assert!(scenario.store.answers(&input.header.id)?.is_empty());
    let page = decisions::list(
        &mut scenario.store,
        &scenario.owner,
        &scenario.agent.principal_id,
        1,
        20,
        Some(DecisionStatus::Pending),
        NOW + 10,
    )?;
    assert_eq!(page.total_items, 0);
    let input = request(&scenario.report.run_id);
    decisions::create(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &input,
        NOW,
    )?;
    assert!(
        decisions::answer(
            &mut scenario.store,
            &scenario.owner,
            &scenario.agent.principal_id,
            &input.header.id,
            &[Answer {
                question_id: "question".to_owned(),
                option_id: Some("yes".to_owned()),
                text: None
            }],
            "late",
            NOW + 30_000
        )
        .is_err()
    );
    decisions::expire(&mut scenario.store, NOW + 30_000)?;
    assert_eq!(
        scenario
            .store
            .decision(&input.header.id)?
            .ok_or("Missing decision")?
            .summary
            .status,
        DecisionStatus::Expired
    );
    Ok(())
}

#[test]
fn decision_children_follow_transaction_rollback_and_summary_reads_exclude_review()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let input = request(&scenario.report.run_id);
    let result = scenario.store.transaction(|store| {
        decisions::create(
            store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &input,
            NOW,
        )?;
        Err::<(), _>(Failure::new(ErrorCode::Conflict, "Rollback"))
    });
    assert!(result.is_err());
    assert!(scenario.store.decision(&input.header.id)?.is_none());
    let mut database = scenario.database()?;
    assert_eq!(
        runtime_decision_question::table
            .filter(runtime_decision_question::decision_id.eq(&input.header.id))
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    let mut invalid = input.clone();
    invalid.questions.push(invalid.questions[0].clone());
    assert!(
        decisions::create(
            &mut scenario.store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &invalid,
            NOW
        )
        .is_err()
    );
    let mut input = input;
    input.review = "x".repeat(26_036);
    decisions::create(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &input,
        NOW,
    )?;
    let page = decisions::list(
        &mut scenario.store,
        &scenario.owner,
        &scenario.agent.principal_id,
        1,
        20,
        None,
        NOW,
    )?;
    assert_eq!(page.items.len(), 1);
    assert!(page.items[0].header == input.header);
    Ok(())
}

#[test]
fn observations_validate_scope_order_and_public_settings_and_track_failure_recovery()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let mut input = observation();
    observations::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report.run_id,
        &input,
        &context(),
        NOW,
    )?;
    let mut invalid = input.clone();
    invalid.settings[0].name = "machine_secret".to_owned();
    assert!(
        observations::report(
            &mut scenario.store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &scenario.report.run_id,
            &invalid,
            &context(),
            NOW
        )
        .is_err()
    );
    invalid = input.clone();
    invalid.room_id = Some("!other:example.test".to_owned());
    assert!(
        observations::report(
            &mut scenario.store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &scenario.report.run_id,
            &invalid,
            &context(),
            NOW
        )
        .is_err()
    );
    invalid = input.clone();
    invalid.observed_at = NOW - 1;
    assert!(
        observations::report(
            &mut scenario.store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &scenario.report.run_id,
            &invalid,
            &context(),
            NOW
        )
        .is_err()
    );
    invalid = input.clone();
    invalid.last_activity_at = Some(NOW + 60_001);
    assert!(
        observations::report(
            &mut scenario.store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &scenario.report.run_id,
            &invalid,
            &context(),
            NOW
        )
        .is_err()
    );
    input.state = State::Failed;
    input.error_message = Some("Native execution failed".to_owned());
    observations::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report.run_id,
        &input,
        &context(),
        NOW,
    )?;
    observations::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report.run_id,
        &input,
        &context(),
        NOW,
    )?;
    let incidents = scenario.store.active_incidents()?;
    assert_eq!(incidents.len(), 1);
    let notice = scenario
        .store
        .notification(&incidents[0].id, NotificationPhase::Initial)?
        .ok_or("Missing notice")?;
    assert!(notice.body.contains("agent (owner) failed"));
    assert!(notice.body.contains("Controller: Fixture controller"));
    input.state = State::Working;
    input.error_message = None;
    observations::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report.run_id,
        &input,
        &context(),
        NOW + 1,
    )?;
    assert!(scenario.store.active_incidents()?.is_empty());
    assert!(
        scenario
            .store
            .notification(&incidents[0].id, NotificationPhase::Recovery)?
            .is_some()
    );
    let current = observations::read(
        &mut scenario.store,
        &scenario.owner,
        &scenario.agent.principal_id,
        NOW,
    )?;
    assert_eq!(current.len(), 1);
    assert!(current[0].observation == input);
    assert_eq!(
        summarize(&current).ok_or("Missing summary")?.state,
        SummaryState::Native(State::Working)
    );
    Ok(())
}

#[test]
fn incidents_are_episode_bound_and_contact_loss_is_not_reported_as_a_crash()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    incidents::watch(&mut scenario.store, &context(), NOW + 90_000)?;
    let active = scenario.store.active_incidents()?;
    assert_eq!(active.len(), 2);
    assert!(
        active
            .iter()
            .all(|incident| incident.kind == IncidentKind::Contact)
    );
    incidents::watch(&mut scenario.store, &context(), NOW + 90_001)?;
    assert_eq!(scenario.store.active_incidents()?.len(), 2);
    let id = identity::id();
    let input = IncidentInput {
        owner_id: &scenario.owner.principal_id,
        agent_id: Some(&scenario.agent.principal_id),
        fleet_id: None,
        run_id: None,
        session_id: Some("session"),
        kind: IncidentKind::Failure,
        message: "Failure",
    };
    scenario
        .store
        .transaction(|store| incidents::open(store, &input, Some(&id), &context(), NOW))?;
    scenario
        .store
        .transaction(|store| incidents::open(store, &input, Some(&id), &context(), NOW))?;
    let conflicting = IncidentInput {
        message: "Different failure",
        ..input
    };
    assert_eq!(
        scenario
            .store
            .transaction(|store| incidents::open(store, &conflicting, Some(&id), &context(), NOW))
            .err()
            .map(|error| error.code),
        Some(ErrorCode::Conflict)
    );
    incidents::recover(
        &mut scenario.store,
        Some(&scenario.agent.principal_id),
        None,
        Some("other-session"),
        Some(IncidentKind::Failure),
        NOW,
    )?;
    assert!(
        scenario
            .store
            .incident(&id)?
            .ok_or("Missing incident")?
            .recovered_at
            .is_none()
    );
    incidents::recover(
        &mut scenario.store,
        Some(&scenario.agent.principal_id),
        None,
        Some("session"),
        Some(IncidentKind::Failure),
        NOW,
    )?;
    assert!(
        scenario
            .store
            .incident(&id)?
            .ok_or("Missing incident")?
            .recovered_at
            .is_some()
    );
    Ok(())
}
