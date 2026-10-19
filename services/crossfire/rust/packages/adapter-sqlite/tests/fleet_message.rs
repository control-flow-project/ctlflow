mod support;
use crossfire_domain::{
    fleet::{
        authority,
        message::{self, Create, DeliveryState, MessageRepository, Receipt},
        values::FleetActor,
    },
    identity::Status,
    port::{AuthorizationRepository, CoreRepository},
};
use crossfire_kernel::{failure::ErrorCode, identity};
use support::{NOW, Scenario};
#[test]
fn fleet_messages_are_authorized_bounded_repeatable_attributed_and_receipted_by_the_controller()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    let mut database = scenario.database()?;
    assert_eq!(
        crossfire_adapter_sqlite::schema::pragma(database.connection(), "user_version")?,
        crossfire_adapter_sqlite::schema::SCHEMA_VERSION
    );
    let owner = FleetActor::Principal(scenario.owner.clone());
    let controller = authority::authenticate_controller(
        &mut scenario.store,
        &scenario.report.controller.credential,
    )?;
    let fleet = scenario.report.controller.fleet_id.clone();
    let id = identity::id();
    assert_eq!(
        message::create(
            &mut scenario.store,
            &FleetActor::Principal(guest),
            &fleet,
            Create {
                id: &id,
                body: "Hello"
            },
            "guest",
            NOW
        )
        .err()
        .ok_or("Unauthorized sender")?
        .code,
        ErrorCode::Forbidden
    );
    assert!(
        message::create(
            &mut scenario.store,
            &owner,
            &fleet,
            Create {
                id: &id,
                body: "  \n"
            },
            "invalid",
            NOW
        )
        .is_err()
    );
    let first = message::create(
        &mut scenario.store,
        &owner,
        &fleet,
        Create {
            id: &id,
            body: "Please reread the updated instructions.",
        },
        "owner",
        NOW,
    )?;
    assert_eq!(first.pending, 1);
    assert_eq!(first.total, 1);
    assert_eq!(first.delivered, 0);
    assert_eq!(
        message::create(
            &mut scenario.store,
            &owner,
            &fleet,
            Create {
                id: &id,
                body: &first.message.body
            },
            "retry",
            NOW + 1
        )?
        .pending,
        1
    );
    assert!(
        message::create(
            &mut scenario.store,
            &owner,
            &fleet,
            Create {
                id: &id,
                body: "Changed body"
            },
            "mismatch",
            NOW + 1
        )
        .is_err()
    );
    let control = message::control(
        &mut scenario.store,
        &controller,
        &fleet,
        &scenario.report.controller.connection_id,
        NOW + 1,
    )?;
    assert_eq!(control.messages.len(), 1);
    assert_eq!(
        control.messages[0].sender_backend_user_id.as_deref(),
        Some("@owner:example.test")
    );
    assert_eq!(
        control.messages[0].agent_ids,
        [scenario.agent.principal_id.clone()]
    );
    assert!(
        message::acknowledge(
            &mut scenario.store,
            &owner,
            Receipt {
                fleet: &fleet,
                message: &id,
                agent: &scenario.agent.principal_id,
                state: DeliveryState::Delivered,
                error_message: None
            },
            NOW + 2
        )
        .is_err()
    );
    for now in [NOW + 2, NOW + 3] {
        assert!(message::acknowledge(
            &mut scenario.store,
            &controller,
            Receipt {
                fleet: &fleet,
                message: &id,
                agent: &scenario.agent.principal_id,
                state: DeliveryState::Delivered,
                error_message: None
            },
            now
        )?);
    }
    assert!(
        message::acknowledge(
            &mut scenario.store,
            &controller,
            Receipt {
                fleet: &fleet,
                message: &id,
                agent: &scenario.agent.principal_id,
                state: DeliveryState::Failed,
                error_message: Some("wrong")
            },
            NOW + 4
        )
        .is_err()
    );
    let page = message::list(&mut scenario.store, &owner, &fleet, 1, 20, NOW + 4)?;
    assert_eq!(page.total_items, 1);
    assert_eq!(page.items[0].delivered, 1);
    assert_eq!(page.items[0].pending, 0);
    assert!(
        message::control(
            &mut scenario.store,
            &controller,
            &fleet,
            &scenario.report.controller.connection_id,
            NOW + 5
        )?
        .messages
        .is_empty()
    );
    assert!(
        scenario
            .store
            .pending_fleet_messages(&fleet, NOW + 5)?
            .is_empty()
    );
    let created = message::create(
        &mut scenario.store,
        &controller,
        &fleet,
        Create {
            id: &identity::id(),
            body: "Controller diagnostic",
        },
        "controller",
        NOW + 5,
    )?;
    assert!(created.message.author_principal_id.is_none());
    assert!(created.message.author_credential_id.is_some());
    Ok(())
}
#[test]
fn expired_deliveries_and_suspended_agents_do_not_grow_the_current_controller_queue()
-> Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let owner = FleetActor::Principal(scenario.owner.clone());
    let fleet = scenario.report.controller.fleet_id.clone();
    let id = identity::id();
    let first = message::create(
        &mut scenario.store,
        &owner,
        &fleet,
        Create {
            id: &id,
            body: "Finite lifetime",
        },
        "owner",
        NOW,
    )?;
    assert_eq!(
        message::list(
            &mut scenario.store,
            &owner,
            &fleet,
            1,
            20,
            first.message.expires_at
        )?
        .items[0]
            .expired,
        1
    );
    assert!(
        scenario
            .store
            .pending_fleet_messages(&fleet, first.message.expires_at)?
            .is_empty()
    );
    let mut principal = scenario
        .store
        .principal(&scenario.agent.principal_id)?
        .ok_or("Agent")?;
    principal.status = Status::Suspended;
    scenario.store.save_principal(&principal)?;
    let second = message::create(
        &mut scenario.store,
        &owner,
        &fleet,
        Create {
            id: &identity::id(),
            body: "Do not start suspended accounts",
        },
        "owner",
        NOW + 1,
    )?;
    assert_eq!(second.skipped, 1);
    assert_eq!(second.pending, 0);
    assert_eq!(
        scenario
            .store
            .fleet_message_delivery(&second.message.id, &scenario.agent.principal_id)?
            .ok_or("Skipped delivery")?
            .error_message
            .as_deref(),
        Some("Agent account is not active")
    );
    let mut database = scenario.database()?;
    assert_eq!(
        crossfire_adapter_sqlite::schema::pragma(database.connection(), "user_version")?,
        crossfire_adapter_sqlite::schema::SCHEMA_VERSION
    );
    assert_eq!(scenario.report.messages_delivered, 0);
    Ok(())
}
