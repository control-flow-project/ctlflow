mod support;
use crossfire_domain::{
    fleet::{
        authority,
        native_stop::{self, NativeStopRepository, RetirementRepository, Selection, StopInput},
        retire, runtime,
        values::FleetActor,
    },
    identity::Status,
    listener,
    port::{AuthorizationRepository, FleetRepository, ListenerRepository},
};
use crossfire_kernel::{failure::ErrorCode, identity};
use support::{NOW, Scenario};
#[test]
fn retirement_requires_exact_live_controller_native_close_and_settled_receipts_before_identity_is_preserved_offline()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    let mut database = scenario.database()?;
    assert_eq!(
        crossfire_adapter_sqlite::schema::pragma(database.connection(), "user_version")?,
        crossfire_adapter_sqlite::schema::SCHEMA_VERSION
    );
    let controller = authority::authenticate_controller(
        &mut scenario.store,
        &scenario.report.controller.credential,
    )?;
    let owner = FleetActor::Principal(scenario.owner.clone());
    let ids = [scenario.agent.principal_id.clone()];
    assert!(
        !native_stop::eligibility(&mut scenario.store, Selection::Agents(&ids), NOW)?.agents
            [&ids[0]]
            .1
    );
    let receipt = identity::id();
    let fleet = scenario.report.controller.fleet_id.clone();
    let connection = scenario.report.controller.connection_id.clone();
    let run = scenario.report.run_id.clone();
    assert_eq!(
        native_stop::record(
            &mut scenario.store,
            &FleetActor::Principal(guest),
            StopInput {
                fleet: &fleet,
                agent: &ids[0],
                connection: &connection,
                run: &run,
                receipt: &receipt
            },
            NOW
        )
        .err()
        .ok_or("Untrusted stop source")?
        .code,
        ErrorCode::Forbidden
    );
    let input = StopInput {
        fleet: &fleet,
        agent: &ids[0],
        connection: &connection,
        run: &run,
        receipt: &receipt,
    };
    assert_eq!(
        native_stop::record(&mut scenario.store, &controller, input, NOW)
            .err()
            .ok_or("Running native generation")?
            .code,
        ErrorCode::Conflict
    );
    scenario.report.stopped = true;
    listener::report(
        &mut scenario.store,
        &scenario.agent,
        &ids[0],
        &scenario.report,
        "release-current",
        NOW + 1,
    )?;
    native_stop::record(
        &mut scenario.store,
        &controller,
        StopInput {
            fleet: &fleet,
            agent: &ids[0],
            connection: &connection,
            run: &run,
            receipt: &receipt,
        },
        NOW + 2,
    )?;
    native_stop::record(
        &mut scenario.store,
        &controller,
        StopInput {
            fleet: &fleet,
            agent: &ids[0],
            connection: &connection,
            run: &run,
            receipt: &receipt,
        },
        NOW + 3,
    )?;
    assert_eq!(
        scenario
            .store
            .native_stop(&ids[0])?
            .ok_or("Stop proof")?
            .sequence,
        1
    );
    assert!(
        native_stop::eligibility(&mut scenario.store, Selection::Agents(&ids), NOW + 3)?.agents
            [&ids[0]]
            .1
    );
    assert!(
        !native_stop::eligibility(&mut scenario.store, Selection::Agents(&ids), NOW + 30000)?
            .agents[&ids[0]]
            .1
    );
    let operation = runtime::Request {
        operation_id: identity::id(),
        agent_id: None,
        action: runtime::Action::Stop,
        expected_revision: 0,
        confirm_fresh_history: false,
    };
    runtime::request(
        &mut scenario.store,
        &owner,
        &fleet,
        &operation,
        "stop",
        NOW + 3,
    )?;
    let revision = scenario
        .store
        .fleet(&fleet)?
        .ok_or("Fleet after stop request")?
        .revision;
    assert_eq!(revision, 1);
    assert!(
        !native_stop::eligibility(&mut scenario.store, Selection::Agents(&ids), NOW + 3)?.agents
            [&ids[0]]
            .1
    );
    assert_eq!(
        retire::archive(
            &mut scenario.store,
            &owner,
            &fleet,
            revision,
            "archive",
            NOW + 3
        )
        .err()
        .ok_or("Pending operation")?
        .code,
        ErrorCode::Conflict
    );
    runtime::claim(
        &mut scenario.store,
        &controller,
        &fleet,
        &operation.operation_id,
        &connection,
        NOW + 4,
    )?;
    runtime::receipt(
        &mut scenario.store,
        &controller,
        &fleet,
        &operation.operation_id,
        &runtime::Receipt {
            connection_id: connection,
            status: runtime::Status::Succeeded,
            error_message: None,
        },
        NOW + 5,
    )?;
    retire::remove(
        &mut scenario.store,
        &owner,
        retire::Remove {
            fleet: &fleet,
            agent: &ids[0],
            instance: "agent",
            expected_revision: revision,
            request_id: "retire",
        },
        NOW + 6,
    )?;
    assert_eq!(
        scenario
            .store
            .principal(&ids[0])?
            .ok_or("Preserved identity")?
            .status,
        Status::Suspended
    );
    assert!(
        scenario
            .store
            .fleet_instance_by_agent(&ids[0])?
            .ok_or("Preserved binding")?
            .retired_at
            .is_some()
    );
    assert_eq!(scenario.store.fleet(&fleet)?.ok_or("Fleet")?.revision, 2);
    assert!(
        scenario
            .store
            .listener_run(&run)?
            .ok_or("Saved run")?
            .stopped_at
            .is_some()
    );
    assert!(
        scenario
            .store
            .retirement(Selection::Fleets(&[fleet]), NOW + 7)?
            .agents
            .is_empty()
    );
    Ok(())
}
#[test]
fn native_stop_invalidation_cannot_be_reused_or_archive_an_agent_that_resumed()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let controller = authority::authenticate_controller(
        &mut scenario.store,
        &scenario.report.controller.credential,
    )?;
    let owner = FleetActor::Principal(scenario.owner.clone());
    let ids = [scenario.agent.principal_id.clone()];
    scenario.report.stopped = true;
    listener::report(
        &mut scenario.store,
        &scenario.agent,
        &ids[0],
        &scenario.report,
        "release-current",
        NOW + 1,
    )?;
    let fleet = scenario.report.controller.fleet_id.clone();
    let connection = scenario.report.controller.connection_id.clone();
    let run = scenario.report.run_id.clone();
    let receipt = identity::id();
    native_stop::record(
        &mut scenario.store,
        &controller,
        StopInput {
            fleet: &fleet,
            agent: &ids[0],
            connection: &connection,
            run: &run,
            receipt: &receipt,
        },
        NOW + 2,
    )?;
    scenario.store.invalidate_native_stop(&ids[0], NOW + 3)?;
    assert!(
        !native_stop::eligibility(
            &mut scenario.store,
            Selection::Fleets(std::slice::from_ref(&fleet)),
            NOW + 3
        )?
        .fleets[&fleet]
    );
    assert_eq!(
        native_stop::record(
            &mut scenario.store,
            &controller,
            StopInput {
                fleet: &fleet,
                agent: &ids[0],
                connection: &connection,
                run: &run,
                receipt: &receipt
            },
            NOW + 3
        )
        .err()
        .ok_or("Invalidated proof")?
        .code,
        ErrorCode::Conflict
    );
    assert!(retire::archive(&mut scenario.store, &owner, &fleet, 0, "archive", NOW + 3).is_err());
    assert_eq!(
        scenario
            .store
            .principal(&ids[0])?
            .ok_or("Active identity")?
            .status,
        Status::Active
    );
    assert!(
        scenario
            .store
            .fleet(&fleet)?
            .ok_or("Active fleet")?
            .archived_at
            .is_none()
    );
    let mut database = scenario.database()?;
    assert_eq!(
        crossfire_adapter_sqlite::schema::pragma(database.connection(), "application_id")?,
        1129465426
    );
    Ok(())
}
