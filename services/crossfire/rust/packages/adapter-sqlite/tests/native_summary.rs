mod support;

use crossfire_adapter_sqlite::tables::fleet_native_stop;
use crossfire_domain::{
    fleet::{
        authority,
        native_stop::NativeStopRepository,
        runtime::{self, Action, Receipt, Request, Status as OperationStatus},
        values::FleetActor,
    },
    listener,
    port::ListenerRepository,
    runtime::{port::ObservationRepository, values::*},
};
use crossfire_kernel::{Result, identity};
use diesel::prelude::*;
use support::{NOW, Scenario};

fn save(scenario: &mut Scenario, run_id: &str, state: State, at: i64) -> Result<()> {
    scenario.store.save_observation(
        &scenario.agent.principal_id,
        &ObservationView {
            run_id: run_id.to_owned(),
            observation: Observation {
                session_id: "native-history".to_owned(),
                room_id: None,
                runtime: Runtime::Codex,
                state,
                observed_at: at,
                last_activity_at: Some(NOW),
                history_available: Some(true),
                history_mode: HistoryMode::Shared,
                max_input_bytes: INPUT_BYTES,
                settings: Vec::new(),
                error_message: None,
            },
        },
    )
}

#[test]
fn stopped_summary_requires_controller_evidence_and_never_overrides_a_newer_run()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    assert!(
        scenario
            .store
            .native_summaries(&[guest.principal_id])?
            .is_empty()
    );
    let run_id = scenario.report.run_id.clone();
    save(&mut scenario, &run_id, State::Working, NOW)?;
    let ids = [scenario.agent.principal_id.clone()];
    assert_eq!(
        scenario
            .store
            .native_summaries(&ids)?
            .get(&ids[0])
            .ok_or("Missing summary")?
            .state,
        SummaryState::Native(State::Working)
    );
    scenario.report.stopped = true;
    listener::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report,
        "release-current",
        NOW,
    )?;
    assert_eq!(
        scenario
            .store
            .native_summaries(&ids)?
            .get(&ids[0])
            .ok_or("Missing summary")?
            .state,
        SummaryState::Native(State::Working)
    );
    let owner = FleetActor::Principal(scenario.owner.clone());
    let controller = authority::authenticate_controller(
        &mut scenario.store,
        &scenario.report.controller.credential,
    )?;
    let request = Request {
        operation_id: identity::id(),
        agent_id: None,
        action: Action::Stop,
        expected_revision: 0,
        confirm_fresh_history: false,
    };
    let fleet_id = &scenario.report.controller.fleet_id;
    runtime::request(&mut scenario.store, &owner, fleet_id, &request, "stop", NOW)?;
    runtime::claim(
        &mut scenario.store,
        &controller,
        fleet_id,
        &request.operation_id,
        &scenario.report.controller.connection_id,
        NOW,
    )?;
    runtime::receipt(
        &mut scenario.store,
        &controller,
        fleet_id,
        &request.operation_id,
        &Receipt {
            connection_id: scenario.report.controller.connection_id.clone(),
            status: OperationStatus::Succeeded,
            error_message: None,
        },
        NOW + 1,
    )?;
    let summaries = scenario.store.native_summaries(&ids)?;
    let summary = summaries.get(&ids[0]).ok_or("Missing summary")?;
    assert_eq!(summary.state, SummaryState::Stopped);
    assert_eq!(summary.observed_at, NOW + 1);
    assert_eq!(summary.last_activity_at, Some(NOW));
    assert_eq!(summary.history_available, Some(true));
    let mut database = scenario.database()?;
    assert_eq!(
        fleet_native_stop::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    scenario.report.run_id = identity::id();
    scenario.report.stopped = false;
    listener::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report,
        "release-current",
        NOW + 2,
    )?;
    let run_id = scenario.report.run_id.clone();
    save(&mut scenario, &run_id, State::Idle, NOW + 2)?;
    assert_eq!(
        scenario
            .store
            .native_summaries(&ids)?
            .get(&ids[0])
            .ok_or("Missing summary")?
            .state,
        SummaryState::Native(State::Idle)
    );
    Ok(())
}

#[test]
fn invalidated_native_stop_proofs_are_not_reported_as_current_stop_evidence()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let run_id = scenario.report.run_id.clone();
    save(&mut scenario, &run_id, State::Working, NOW)?;
    scenario.report.stopped = true;
    listener::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report,
        "release-current",
        NOW,
    )?;
    let controller = scenario
        .store
        .listener_run(&run_id)?
        .ok_or("Missing run")?
        .controller
        .ok_or("Missing controller")?;
    let mut database = scenario.database()?;
    diesel::insert_into(fleet_native_stop::table)
        .values((
            fleet_native_stop::agent_id.eq(&scenario.agent.principal_id),
            fleet_native_stop::receipt_id.eq(identity::id()),
            fleet_native_stop::sequence.eq(1),
            fleet_native_stop::fleet_id.eq(&controller.fleet_id),
            fleet_native_stop::run_id.eq(&run_id),
            fleet_native_stop::connection_id.eq(&controller.connection_id),
            fleet_native_stop::credential_id.eq(&controller.credential_id),
            fleet_native_stop::native_stopped_at.eq(NOW + 1),
        ))
        .execute(database.connection())?;
    let ids = [scenario.agent.principal_id.clone()];
    assert_eq!(
        scenario
            .store
            .native_summaries(&ids)?
            .get(&ids[0])
            .ok_or("Missing summary")?
            .state,
        SummaryState::Stopped
    );
    scenario
        .store
        .invalidate_native_stop(&scenario.agent.principal_id, NOW + 2)?;
    assert_eq!(
        scenario
            .store
            .native_summaries(&ids)?
            .get(&ids[0])
            .ok_or("Missing summary")?
            .state,
        SummaryState::Native(State::Working)
    );
    Ok(())
}
