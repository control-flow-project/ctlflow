use super::{
    context::Context,
    reply::{self, Reply},
};
use crossfire_contracts::{room_access as wire, room_plan, validation as check};
use crossfire_domain::{
    authorization::authorize,
    port::RepositoryAccess,
    room_access::{self, port::RoomRepository, read::RoomQuery},
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode, identity};
use serde_json::json;

pub async fn rooms(context: &Context<'_>) -> Result<Reply> {
    let values = room_access::read::rooms(
        &context.state.repository,
        &context.state.matrix,
        &identity::now,
        RoomQuery {
            actor: context.actor()?,
            agent: context.query.identifier("agentId")?,
            search: context.query.search()?,
            pagination: context.query.page()?,
        },
        |first, second| context.state.digest.compare(first, second),
    )
    .await?;
    reply::page(values, |value| Ok(wire::room(value)))
}
pub async fn room(context: &Context<'_>) -> Result<Reply> {
    let value = room_access::read::room(
        &context.state.repository,
        &context.state.matrix,
        &identity::now,
        context.actor()?,
        context.parameter("roomId")?,
        context.query.identifier("agentId")?,
    )
    .await?;
    reply::of(wire::room(&value))
}
pub fn grants(context: &Context<'_>) -> Result<Reply> {
    let selected = context
        .query
        .get("roomIds")
        .map(|value| {
            if value.len() > 16384 {
                return Err(Failure::new(
                    ErrorCode::Invalid,
                    "Room filter exceeds its size bound",
                ));
            }
            let value = serde_json::from_str(value)
                .map_err(|_| Failure::new(ErrorCode::Invalid, "roomIds must be a JSON array"))?;
            let ids = check::list(&value, 0, 100)?
                .iter()
                .map(check::room_id)
                .collect::<Result<Vec<_>>>()?;
            if ids.iter().collect::<std::collections::BTreeSet<_>>().len() != ids.len() {
                return Err(Failure::new(ErrorCode::Invalid, "Duplicate room filter"));
            }
            Ok(ids)
        })
        .transpose()?;
    let page = context.query.page()?;
    let values = context.with(|repo, now| {
        room_access::read::grants(
            repo,
            context.actor()?,
            context.parameter("agentId")?,
            page,
            selected.as_deref(),
            now,
        )
    })?;
    reply::page(values, |value| Ok(wire::grant_view(value)))
}
pub async fn grant(context: &Context<'_>) -> Result<Reply> {
    let value = room_access::read::grant(
        &context.state.repository,
        &context.state.matrix,
        &identity::now,
        context.actor()?,
        context.parameter("agentId")?,
        context.parameter("roomId")?,
    )
    .await?;
    reply::of(wire::grant_view(&value))
}
pub async fn change(context: &Context<'_>, removal: bool) -> Result<Reply> {
    let input = wire::change(
        &context.input,
        context.parameter("agentId")?,
        context.parameter("roomId")?,
        removal,
    )?;
    context
        .state
        .rooms()
        .change(context.actor()?, &input, None, &context.request_id)
        .await?;
    grant(context).await
}
pub async fn permissions(context: &Context<'_>) -> Result<Reply> {
    grant(context).await
}
pub async fn set_permissions(context: &Context<'_>) -> Result<Reply> {
    let input = wire::permissions(
        &context.input,
        context.parameter("agentId")?,
        context.parameter("roomId")?,
    )?;
    context
        .state
        .rooms()
        .set_permission(context.actor()?, &input, &context.request_id)?;
    permissions(context).await
}
pub async fn accept(context: &Context<'_>) -> Result<Reply> {
    let input = check::object(&context.input, &["roomId"], &[])?;
    let room = check::room_id(&input["roomId"])?;
    let value = room_access::invitation::accept(
        &context.state.repository,
        &context.state.matrix,
        &context.state.room_operations,
        &identity::now,
        room_access::invitation::Request {
            receiver: context.actor()?,
            agent: context.parameter("agentId")?,
            room: &room,
            request_id: &context.request_id,
        },
    )
    .await?;
    reply::of(json!({"accepted":value}))
}
pub async fn owner_conversation(context: &Context<'_>) -> Result<Reply> {
    context.empty()?;
    let agent = context.parameter("agentId")?;
    context.with(|repo, now| {
        let actor = context.actor()?;
        authorize(
            repo,
            actor,
            crossfire_domain::permission::Permission::OwnerConversationEnsureSelf,
            now,
        )?;
        if actor.kind != crossfire_domain::identity::PrincipalKind::Agent
            || actor.principal_id != agent
        {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Only this agent can connect its owner conversation",
            ));
        }
        Ok(())
    })?;
    let room = room_access::owner_conversation::ensure(
        &context.state.repository,
        &context.state.matrix,
        &context.state.room_operations,
        &identity::now,
        agent,
        None,
    )
    .await?;
    context.state.repository.with(|repo| {
        let bound = repo.owner_conversation(agent)?.ok_or_else(|| {
            Failure::new(
                ErrorCode::Unavailable,
                "Owner conversation is not established",
            )
        })?;
        if bound.room_id != room {
            return Err(Failure::new(
                ErrorCode::Conflict,
                "Owner conversation changed",
            ));
        }
        reply::of(json!({"roomId":room}))
    })
}
pub async fn preview(context: &Context<'_>) -> Result<Reply> {
    let value = check::object(&context.input, &["plan"], &[])?;
    let plan = room_plan::plan(&value["plan"])?;
    let value = room_access::plan::preview(
        &context.state.rooms(),
        &context.state.digest,
        context.actor()?,
        &plan,
    )
    .await?;
    reply::of(room_plan::preview(&value))
}
pub async fn apply(context: &Context<'_>) -> Result<Reply> {
    let value = check::object(&context.input, &["plan", "digest", "snapshots"], &[])?;
    let plan = room_plan::plan(&value["plan"])?;
    let snapshots = room_plan::snapshots(&value["snapshots"])?;
    let digest = check::text(&value["digest"], 64, 64)?;
    let agents = room_access::plan::apply(
        &context.state.rooms(),
        &context.state.digest,
        context.actor()?,
        &plan,
        digest,
        &snapshots,
        &context.request_id,
    )
    .await?;
    reply::of(json!({"accepted":true,"agents":agents}))
}
