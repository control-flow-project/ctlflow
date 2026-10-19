use crate::store::Store;
use crate::{error::failure, expression::coalesce, tables::*};
use crossfire_kernel::Result;
use diesel::{
    dsl::{exists, not},
    prelude::*,
};

pub(super) fn prune(store: &mut Store, cutoff: i64, limit: i64) -> Result<Vec<usize>> {
    let audits = audit_event::table
        .filter(audit_event::created_at.lt(cutoff))
        .order((audit_event::created_at.asc(), audit_event::id.asc()))
        .limit(limit)
        .select(audit_event::id)
        .load::<String>(store.database.connection())
        .map_err(failure)?;
    diesel::delete(audit_event::table.filter(audit_event::id.eq_any(&audits)))
        .execute(store.database.connection())
        .map_err(failure)?;
    let notices = wake_notice::table
        .filter(
            wake_notice::status
                .ne("pending")
                .and(coalesce(wake_notice::sent_at, wake_notice::reserved_at).lt(cutoff)),
        )
        .order(wake_notice::reserved_at.asc())
        .limit(limit)
        .select((
            wake_notice::receiver_agent_id,
            wake_notice::room_id,
            wake_notice::event_id,
        ))
        .load::<(String, String, String)>(store.database.connection())
        .map_err(failure)?;
    for (receiver, room, event) in &notices {
        diesel::delete(
            wake_notice::table.filter(
                wake_notice::receiver_agent_id
                    .eq(receiver)
                    .and(wake_notice::room_id.eq(room))
                    .and(wake_notice::event_id.eq(event)),
            ),
        )
        .execute(store.database.connection())
        .map_err(failure)?;
    }
    let wakes = wake_delivery::table
        .filter(
            wake_delivery::status
                .ne("pending")
                .and(coalesce(wake_delivery::delivered_at, wake_delivery::created_at).lt(cutoff)),
        )
        .order((wake_delivery::created_at.asc(), wake_delivery::id.asc()))
        .limit(limit)
        .select(wake_delivery::id)
        .load::<String>(store.database.connection())
        .map_err(failure)?;
    diesel::delete(wake_delivery::table.filter(wake_delivery::id.eq_any(&wakes)))
        .execute(store.database.connection())
        .map_err(failure)?;
    let messages = fleet_message::table
        .filter(fleet_message::expires_at.lt(cutoff))
        .order((fleet_message::expires_at.asc(), fleet_message::id.asc()))
        .limit(limit)
        .select(fleet_message::id)
        .load::<String>(store.database.connection())
        .map_err(failure)?;
    diesel::delete(fleet_message::table.filter(fleet_message::id.eq_any(&messages)))
        .execute(store.database.connection())
        .map_err(failure)?;
    let invitations = member_invitation::table
        .filter(
            member_invitation::expires_at.lt(cutoff).and(
                member_invitation::consumed_by_member_id
                    .is_not_null()
                    .or(member_invitation::claim_backend_user_id.is_null()),
            ),
        )
        .order((
            member_invitation::expires_at.asc(),
            member_invitation::id.asc(),
        ))
        .limit(limit)
        .select(member_invitation::id)
        .load::<String>(store.database.connection())
        .map_err(failure)?;
    diesel::delete(member_invitation::table.filter(member_invitation::id.eq_any(&invitations)))
        .execute(store.database.connection())
        .map_err(failure)?;
    let reservations =
        agent_name::table.filter(agent_name::request_id.eq(enrollment_request::id.nullable()));
    let rejected = enrollment_request::table
        .filter(
            enrollment_request::status
                .eq_any(["rejected", "expired"])
                .and(
                    coalesce(
                        enrollment_request::decided_at,
                        enrollment_request::expires_at,
                    )
                    .lt(cutoff),
                )
                .and(not(exists(reservations))),
        )
        .order(enrollment_request::created_at.asc())
        .limit(limit)
        .select(enrollment_request::id)
        .load::<String>(store.database.connection())
        .map_err(failure)?;
    diesel::delete(
        enrollment_item_permission::table
            .filter(enrollment_item_permission::request_id.eq_any(&rejected)),
    )
    .execute(store.database.connection())
    .map_err(failure)?;
    diesel::delete(
        enrollment_item_wake_sender::table
            .filter(enrollment_item_wake_sender::request_id.eq_any(&rejected)),
    )
    .execute(store.database.connection())
    .map_err(failure)?;
    diesel::delete(
        enrollment_item_policy::table.filter(enrollment_item_policy::request_id.eq_any(&rejected)),
    )
    .execute(store.database.connection())
    .map_err(failure)?;
    diesel::delete(
        enrollment_controller_metadata::table
            .filter(enrollment_controller_metadata::enrollment_id.eq_any(&rejected)),
    )
    .execute(store.database.connection())
    .map_err(failure)?;
    diesel::delete(enrollment_item::table.filter(enrollment_item::request_id.eq_any(&rejected)))
        .execute(store.database.connection())
        .map_err(failure)?;
    diesel::delete(enrollment_request::table.filter(enrollment_request::id.eq_any(&rejected)))
        .execute(store.database.connection())
        .map_err(failure)?;
    Ok(vec![
        audits.len(),
        notices.len(),
        wakes.len(),
        messages.len(),
        invitations.len(),
        rejected.len(),
    ])
}
