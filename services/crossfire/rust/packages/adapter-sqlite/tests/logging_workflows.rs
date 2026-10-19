mod support;

use crossfire_adapter_sqlite::tables::*;
use crossfire_domain::{
    logging::{DAY_MS, Retention},
    port::{Audit, CoreRepository},
    runtime::{port::IncidentRepository, values::*},
};
use crossfire_kernel::identity;
use diesel::prelude::*;
use support::{NOW, Scenario};

const OLD: i64 = NOW - 10 * DAY_MS;

#[test]
fn expired_workflow_logs_are_removed_without_erasing_pending_claims_rules_or_reserved_names()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    scenario.store.audit(&Audit::new(
        &scenario.owner,
        "old",
        "agent",
        &scenario.agent.principal_id,
        "fixture",
        Some(&scenario.owner.principal_id),
        OLD,
    ))?;
    let mut database = scenario.database()?;
    for status in ["pending", "sent", "denied"] {
        diesel::insert_into(wake_notice::table)
            .values((
                wake_notice::receiver_agent_id.eq(&scenario.agent.principal_id),
                wake_notice::event_id.eq(format!(
                    "$wake-{}",
                    if status == "denied" {
                        "pending"
                    } else {
                        status
                    }
                )),
                wake_notice::sender_backend_user_id.eq("@owner:example.test"),
                wake_notice::room_id.eq(if status == "denied" {
                    "!other:example.test"
                } else {
                    "!room:example.test"
                }),
                wake_notice::reserved_at.eq(OLD),
                wake_notice::message_body.eq("Notice"),
                wake_notice::status.eq(status),
                wake_notice::sent_at.eq((status == "sent").then_some(OLD)),
                wake_notice::native_event_id.eq((status == "sent").then_some("$sent")),
            ))
            .execute(database.connection())?;
    }
    let rule_id = identity::id();
    diesel::insert_into(wake_rule::table)
        .values((
            wake_rule::id.eq(&rule_id),
            wake_rule::owner_id.eq(&scenario.owner.principal_id),
            wake_rule::configured_by_id.eq(&scenario.owner.principal_id),
            wake_rule::name.eq("Retained rule"),
            wake_rule::message.eq("Input"),
            wake_rule::schedule_kind.eq("interval"),
            wake_rule::interval_seconds.eq(60),
            wake_rule::enabled.eq(1),
            wake_rule::revision.eq(0),
            wake_rule::created_at.eq(OLD),
            wake_rule::updated_at.eq(OLD),
        ))
        .execute(database.connection())?;
    diesel::insert_into(wake_rule_agent::table)
        .values((
            wake_rule_agent::rule_id.eq(&rule_id),
            wake_rule_agent::agent_id.eq(&scenario.agent.principal_id),
            wake_rule_agent::next_due_at.eq(OLD),
        ))
        .execute(database.connection())?;
    for status in ["pending", "delivered", "cancelled"] {
        diesel::insert_into(wake_delivery::table)
            .values((
                wake_delivery::id.eq(identity::id()),
                wake_delivery::rule_id.eq(&rule_id),
                wake_delivery::agent_id.eq(&scenario.agent.principal_id),
                wake_delivery::rule_revision.eq(0),
                wake_delivery::run_id.eq(&scenario.report.run_id),
                wake_delivery::session_id.eq(format!("history-{status}")),
                wake_delivery::scheduled_at.eq(OLD),
                wake_delivery::created_at.eq(OLD),
                wake_delivery::status.eq(status),
                wake_delivery::delivered_at.eq((status == "delivered").then_some(OLD)),
            ))
            .execute(database.connection())?;
    }
    let broadcast_id = identity::id();
    diesel::insert_into(fleet_message::table)
        .values((
            fleet_message::id.eq(&broadcast_id),
            fleet_message::fleet_id.eq(&scenario.report.controller.fleet_id),
            fleet_message::author_principal_id.eq(&scenario.owner.principal_id),
            fleet_message::body.eq("Expired broadcast"),
            fleet_message::created_at.eq(OLD),
            fleet_message::expires_at.eq(OLD + 1),
        ))
        .execute(database.connection())?;
    diesel::insert_into(fleet_message_delivery::table)
        .values((
            fleet_message_delivery::message_id.eq(&broadcast_id),
            fleet_message_delivery::agent_id.eq(&scenario.agent.principal_id),
            fleet_message_delivery::status.eq("delivered"),
            fleet_message_delivery::completed_at.eq(OLD),
        ))
        .execute(database.connection())?;
    let claimed_id = identity::id();
    for claim in [false, true] {
        let id = if claim {
            claimed_id.clone()
        } else {
            identity::id()
        };
        diesel::insert_into(member_invitation::table)
            .values((
                member_invitation::id.eq(&id),
                member_invitation::created_by_member_id.eq(&scenario.owner.principal_id),
                member_invitation::claim_hash.eq(identity::hash(&id)),
                member_invitation::role_code.eq("member"),
                member_invitation::principal_kind.eq("human"),
                member_invitation::created_at.eq(OLD),
                member_invitation::expires_at.eq(OLD + 1),
                member_invitation::claim_backend_user_id.eq(claim.then_some("@new:example.test")),
                member_invitation::claim_display_name.eq(claim.then_some("New member")),
                member_invitation::claim_fingerprint.eq(claim.then_some("fingerprint")),
            ))
            .execute(database.connection())?;
    }
    let held_request = identity::id();
    for held in [false, true] {
        let id = if held {
            held_request.clone()
        } else {
            identity::id()
        };
        diesel::insert_into(enrollment_request::table)
            .values((
                enrollment_request::id.eq(&id),
                enrollment_request::owner_id.eq(&scenario.owner.principal_id),
                enrollment_request::fleet_key.eq(if held { "held" } else { "rejected" }),
                enrollment_request::controller_name.eq("Controller"),
                enrollment_request::controller_credential_hash.eq(identity::hash(&id)),
                enrollment_request::verification_code.eq(&id),
                enrollment_request::claim_hash.eq(identity::hash(&id)),
                enrollment_request::roster_digest.eq(identity::hash(&id)),
                enrollment_request::status.eq("rejected"),
                enrollment_request::revision.eq(0),
                enrollment_request::created_at.eq(OLD),
                enrollment_request::expires_at.eq(OLD + 1000),
                enrollment_request::decided_by_member_id.eq(&scenario.owner.principal_id),
                enrollment_request::decided_at.eq(OLD),
            ))
            .execute(database.connection())?;
        diesel::insert_into(enrollment_item::table)
            .values((
                enrollment_item::request_id.eq(&id),
                enrollment_item::instance_key.eq("instance"),
                enrollment_item::requested_name.eq(if held { "reserved" } else { "unused" }),
                enrollment_item::outcome.eq("claimed"),
            ))
            .execute(database.connection())?;
        if held {
            diesel::insert_into(agent_name::table)
                .values((
                    agent_name::name.eq("reserved"),
                    agent_name::request_id.eq(&id),
                    agent_name::instance_key.eq("instance"),
                ))
                .execute(database.connection())?;
        }
    }
    let incident_id = identity::id();
    scenario.store.insert_incident(&Incident {
        id: incident_id.clone(),
        owner_id: scenario.owner.principal_id.clone(),
        agent_id: Some(scenario.agent.principal_id.clone()),
        fleet_id: None,
        run_id: Some(scenario.report.run_id.clone()),
        session_id: None,
        kind: IncidentKind::Contact,
        message: "Recovered".to_owned(),
        created_at: OLD,
        recovered_at: Some(OLD),
    })?;
    for phase in [NotificationPhase::Initial, NotificationPhase::Recovery] {
        scenario.store.insert_notification(&Notification {
            incident_id: incident_id.clone(),
            phase,
            body: "Owner notice".to_owned(),
            next_attempt_at: OLD,
            event_id: Some(format!("$sent-{}", phase.code())),
        })?;
    }
    let mut retention = Retention::new(None)?;
    assert!(retention.maintain(&mut scenario.store, NOW, 500)?.0 > 0);
    assert_eq!(
        audit_event::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    assert_eq!(
        wake_notice::table
            .count()
            .get_result::<i64>(database.connection())?,
        1
    );
    assert_eq!(
        wake_delivery::table
            .count()
            .get_result::<i64>(database.connection())?,
        1
    );
    assert_eq!(
        wake_rule::table
            .count()
            .get_result::<i64>(database.connection())?,
        1
    );
    assert_eq!(
        fleet_message::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    assert_eq!(
        fleet_message_delivery::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    assert_eq!(
        member_invitation::table
            .select(member_invitation::id)
            .first::<String>(database.connection())?,
        claimed_id
    );
    assert_eq!(
        enrollment_request::table
            .select(enrollment_request::id)
            .first::<String>(database.connection())?,
        held_request
    );
    assert_eq!(
        enrollment_item::table
            .count()
            .get_result::<i64>(database.connection())?,
        1
    );
    assert!(scenario.store.incident(&incident_id)?.is_none());
    assert_eq!(
        principal::table
            .filter(principal::id.eq(&guest.principal_id))
            .count()
            .get_result::<i64>(database.connection())?,
        1
    );
    assert_eq!(
        agent_name::table
            .filter(agent_name::name.eq("reserved"))
            .count()
            .get_result::<i64>(database.connection())?,
        1
    );
    Ok(())
}
