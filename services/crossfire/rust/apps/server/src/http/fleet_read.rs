use super::{
    context::Context,
    fleet,
    reply::{self, Reply},
};
use crossfire_contracts::{fleet_map, statistics};
use crossfire_domain::{fleet::values::FleetActor, read, room_access};
use crossfire_kernel::{Result, identity};
use futures_util::{StreamExt, stream};
use serde_json::json;
pub fn statistics(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let hours = fleet::integer(Some(context.query.get("hours").unwrap_or("24")), 1, 720)?;
    let page = fleet::integer(Some(context.query.get("page").unwrap_or("1")), 1, 100000)?;
    let size = fleet::integer(Some(context.query.get("pageSize").unwrap_or("20")), 1, 100)?;
    let value = context.with(|repo, now| {
        read::statistics::read(
            repo,
            context.actor()?,
            context.parameter("fleetId")?,
            hours,
            context.state.configuration.logging_retention_days,
            read::values::Pagination { page, size },
            now,
        )
    })?;
    reply::of(statistics::report(&value)?)
}
pub async fn map(
    context: &Context<'_, impl crossfire_domain::messaging::MessagingAuthority>,
) -> Result<Reply> {
    let mut captured = context.with(|repo, now| {
        read::map::capture(
            repo,
            &context.state.digest,
            context.actor()?,
            context.parameter("fleetId")?,
            now,
        )
    })?;
    let actor = context.actor()?;
    let mut rooms = stream::iter(
        std::mem::take(&mut captured.rooms)
            .into_iter()
            .enumerate()
            .map(|(index, value)| async move {
                let observed = room_access::read::room(
                    &context.state.repository,
                    context.state.messaging.as_ref(),
                    &identity::now,
                    actor,
                    &value.id,
                    Some(&value.observer),
                )
                .await;
                let (name, alias) = match observed {
                    Ok(room) => (
                        if room.name == value.id {
                            None
                        } else {
                            Some(room.name)
                        },
                        room.alias,
                    ),
                    Err(_) => (None, None),
                };
                (index, json!({"roomId":value.id,"name":name,"alias":alias}))
            }),
    )
    .buffer_unordered(4)
    .collect::<Vec<_>>()
    .await;
    rooms.sort_by_key(|(index, _)| *index);
    context.with(|repo, now| {
        read::fleet::read(
            repo,
            &FleetActor::Principal(actor.clone()),
            context.parameter("fleetId")?,
            now,
        )
    })?;
    reply::of(fleet_map::value(
        &captured,
        rooms.into_iter().map(|(_, value)| value).collect(),
    ))
}
