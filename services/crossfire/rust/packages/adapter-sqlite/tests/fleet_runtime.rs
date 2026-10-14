mod support;

use crossfire_adapter_sqlite::tables::audit_event;
use crossfire_contracts::fleet_runtime::OperationWire;
use crossfire_domain::{
    fleet::{
        authority, control,
        runtime::{self, Action, Receipt, Repository, Request, Status},
        values::FleetActor,
    },
    identity::{PrincipalKind, PrincipalRole, Role},
    port::{CoreRepository, FleetRepository},
};
use crossfire_kernel::{failure::ErrorCode, identity};
use diesel::prelude::*;
use support::{NOW, Scenario};

fn input(revision: i64, action: Action) -> Request {
    Request {
        operation_id: identity::id(),
        agent_id: None,
        action,
        expected_revision: revision,
        confirm_fresh_history: action == Action::Reset,
    }
}

#[test]
fn session_requests_are_human_authorized_revision_checked_and_exactly_idempotent()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    let owner = FleetActor::Principal(scenario.owner.clone());
    let controller = authority::authenticate_controller(
        &mut scenario.store,
        &scenario.report.controller.credential,
    )?;
    let fleet_id = &scenario.report.controller.fleet_id;
    let request = input(0, Action::Start);
    assert!(
        runtime::request(
            &mut scenario.store,
            &FleetActor::Principal(guest),
            fleet_id,
            &request,
            "guest",
            NOW
        )
        .is_err()
    );
    assert!(
        runtime::request(
            &mut scenario.store,
            &controller,
            fleet_id,
            &request,
            "controller",
            NOW
        )
        .is_err()
    );
    assert!(
        runtime::request(
            &mut scenario.store,
            &FleetActor::Principal(scenario.agent.clone()),
            fleet_id,
            &request,
            "agent",
            NOW
        )
        .is_err()
    );
    let mut reset = input(0, Action::Reset);
    reset.confirm_fresh_history = false;
    assert_eq!(
        runtime::request(
            &mut scenario.store,
            &owner,
            fleet_id,
            &reset,
            "unconfirmed",
            NOW
        )
        .err()
        .map(|error| error.code),
        Some(ErrorCode::Invalid)
    );
    let mut missing = input(0, Action::Start);
    missing.agent_id = Some(identity::id());
    assert_eq!(
        runtime::request(
            &mut scenario.store,
            &owner,
            fleet_id,
            &missing,
            "missing",
            NOW
        )
        .err()
        .map(|error| error.code),
        Some(ErrorCode::Missing)
    );
    let operation = runtime::request(
        &mut scenario.store,
        &owner,
        fleet_id,
        &request,
        "start",
        NOW,
    )?;
    assert_eq!(operation.status, Status::Pending);
    let retry = runtime::request(
        &mut scenario.store,
        &owner,
        fleet_id,
        &request,
        "retry",
        NOW + 1,
    )?;
    assert!(operation == retry);
    let mut conflicting = request;
    conflicting.action = Action::Stop;
    assert_eq!(
        runtime::request(
            &mut scenario.store,
            &owner,
            fleet_id,
            &conflicting,
            "changed",
            NOW
        )
        .err()
        .map(|error| error.code),
        Some(ErrorCode::Conflict)
    );
    assert!(
        runtime::request(
            &mut scenario.store,
            &owner,
            fleet_id,
            &input(1, Action::Stop),
            "busy",
            NOW
        )
        .is_err()
    );
    assert_eq!(
        scenario
            .store
            .fleet(fleet_id)?
            .ok_or("Missing fleet")?
            .revision,
        1
    );
    let mut database = scenario.database()?;
    assert_eq!(
        audit_event::table
            .filter(audit_event::action.eq("fleet.session.start"))
            .count()
            .get_result::<i64>(database.connection())?,
        1
    );
    let view = serde_json::to_value(OperationWire(&operation))?;
    assert!(view.get("authorPrincipalId").is_none());
    assert!(view.get("credentialId").is_none());
    assert!(view.get("connectionId").is_none());
    Ok(())
}

#[test]
fn claim_and_receipt_require_the_current_connection_and_immutable_final_outcomes()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let owner = FleetActor::Principal(scenario.owner.clone());
    let controller = authority::authenticate_controller(
        &mut scenario.store,
        &scenario.report.controller.credential,
    )?;
    let fleet_id = &scenario.report.controller.fleet_id;
    let connection_id = &scenario.report.controller.connection_id;
    let request = input(0, Action::Stop);
    runtime::request(&mut scenario.store, &owner, fleet_id, &request, "stop", NOW)?;
    let receipt = Receipt {
        connection_id: connection_id.clone(),
        status: Status::Succeeded,
        error_message: None,
    };
    assert!(
        runtime::receipt(
            &mut scenario.store,
            &controller,
            fleet_id,
            &request.operation_id,
            &receipt,
            NOW
        )
        .is_err()
    );
    assert!(
        runtime::claim(
            &mut scenario.store,
            &owner,
            fleet_id,
            &request.operation_id,
            connection_id,
            NOW
        )
        .is_err()
    );
    let running = runtime::claim(
        &mut scenario.store,
        &controller,
        fleet_id,
        &request.operation_id,
        connection_id,
        NOW,
    )?;
    assert_eq!(running.status, Status::Running);
    let replacement = identity::id();
    control::report_connection(
        &mut scenario.store,
        &controller,
        fleet_id,
        &replacement,
        false,
        NOW + 30_000,
    )?;
    assert!(
        runtime::receipt(
            &mut scenario.store,
            &controller,
            fleet_id,
            &request.operation_id,
            &receipt,
            NOW + 30_000
        )
        .is_err()
    );
    runtime::claim(
        &mut scenario.store,
        &controller,
        fleet_id,
        &request.operation_id,
        &replacement,
        NOW + 30_000,
    )?;
    let receipt = Receipt {
        connection_id: replacement.clone(),
        status: Status::Succeeded,
        error_message: None,
    };
    assert!(runtime::receipt(
        &mut scenario.store,
        &controller,
        fleet_id,
        &request.operation_id,
        &receipt,
        NOW + 30_000
    )?);
    assert!(runtime::receipt(
        &mut scenario.store,
        &controller,
        fleet_id,
        &request.operation_id,
        &receipt,
        NOW + 30_001
    )?);
    let differing = Receipt {
        connection_id: replacement,
        status: Status::Failed,
        error_message: Some("Different outcome".to_owned()),
    };
    assert_eq!(
        runtime::receipt(
            &mut scenario.store,
            &controller,
            fleet_id,
            &request.operation_id,
            &differing,
            NOW + 30_001
        )
        .err()
        .map(|error| error.code),
        Some(ErrorCode::Conflict)
    );
    let final_operation = scenario
        .store
        .runtime_operation(&request.operation_id)?
        .ok_or("Missing operation")?;
    assert_eq!(final_operation.status, Status::Succeeded);
    assert_eq!(
        runtime::list(&mut scenario.store, &owner, fleet_id, 1, 20, NOW)?.total_items,
        1
    );
    Ok(())
}

#[test]
fn changed_request_authority_or_roster_stops_unclaimed_session_operations()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let administrator = scenario.add_human("@administrator:example.test")?;
    let assigned = PrincipalRole {
        principal_id: administrator.principal_id.clone(),
        principal_kind: PrincipalKind::Human,
        role: Role::Administrator,
        assigned_by_member_id: Some(scenario.owner.principal_id.clone()),
        assigned_at: NOW,
    };
    scenario.store.save_role(&assigned)?;
    let actor = FleetActor::Principal(administrator);
    let fleet_id = &scenario.report.controller.fleet_id;
    let connection_id = &scenario.report.controller.connection_id;
    let controller = authority::authenticate_controller(
        &mut scenario.store,
        &scenario.report.controller.credential,
    )?;
    let request = input(0, Action::Reset);
    runtime::request(
        &mut scenario.store,
        &actor,
        fleet_id,
        &request,
        "reset",
        NOW,
    )?;
    scenario.store.save_role(&PrincipalRole {
        role: Role::Member,
        ..assigned
    })?;
    let failed = runtime::claim(
        &mut scenario.store,
        &controller,
        fleet_id,
        &request.operation_id,
        connection_id,
        NOW,
    )?;
    assert_eq!(failed.status, Status::Failed);
    assert_eq!(
        failed.error_message.as_deref(),
        Some("Session request authority or roster changed before execution")
    );
    assert!(
        scenario
            .store
            .pending_runtime_operation(fleet_id)?
            .is_none()
    );
    let next = input(1, Action::Stop);
    let owner = FleetActor::Principal(scenario.owner.clone());
    runtime::request(&mut scenario.store, &owner, fleet_id, &next, "stop", NOW)?;
    control::change_delivery(
        &mut scenario.store,
        &controller,
        fleet_id,
        2,
        false,
        "changed",
        NOW,
    )?;
    let failed = runtime::claim(
        &mut scenario.store,
        &controller,
        fleet_id,
        &next.operation_id,
        connection_id,
        NOW,
    )?;
    assert_eq!(failed.status, Status::Failed);
    assert_eq!(
        scenario
            .store
            .runtime_operations(fleet_id, 1, 20)?
            .total_items,
        2
    );
    Ok(())
}
