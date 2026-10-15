use crate::{
    coordination::{self, Coordination},
    matrix::{self, API, Matrix, Request},
    profile::Profile,
};
use crossfire_contracts::{
    call::Call,
    matrix_room,
    operations::{Method, OperationId},
    origin::segment,
    validation as check,
};
use crossfire_kernel::{Failure, Result, failure::ErrorCode};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;

pub async fn authorize(
    coordination: &impl Coordination,
    matrix: &impl Matrix,
    profile: &Profile,
    stop: CancellationToken,
) -> Result<()> {
    let policy = coordination::policy(coordination, profile, stop.clone()).await?;
    if !policy.active {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Agent and owner must both be active",
        ));
    }
    let Some(room) = policy.owner_conversation.as_deref() else {
        return Ok(());
    };
    if !policy.can_reply(room) || policy.room(room).is_none_or(|grant| grant.muted) {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Owner conversation requires unmuted read and reply access",
        ));
    }
    let state = matrix::request(
        matrix,
        &Request::new(Method::Get, format!("{API}/rooms/{}/state", segment(room))),
        stop,
    )
    .await?;
    let state = matrix_room::state(&state)?;
    matrix_room::owner_conversation(&state, &profile.settings.owner, &profile.account.user_id)?;
    for participant in [&profile.settings.owner, &profile.account.user_id] {
        if !state.iter().any(|event| {
            event.event_type == "m.room.member"
                && &event.state_key == participant
                && event.content.get("membership").and_then(Value::as_str) == Some("join")
        }) {
            return Err(Failure::new(
                ErrorCode::Forbidden,
                "Both private conversation participants must have joined",
            ));
        }
    }
    let power = state
        .iter()
        .find(|event| event.event_type == "m.room.power_levels" && event.state_key.is_empty())
        .map_or_else(|| json!({}), |event| Value::Object(event.content.clone()));
    let power = matrix_room::powers(
        power.as_object().ok_or_else(|| {
            Failure::new(ErrorCode::Invalid, "Invalid private conversation powers")
        })?,
        &profile.account.user_id,
    )?;
    if power.owner_level < power.message {
        return Err(Failure::new(
            ErrorCode::Forbidden,
            "Agent cannot send the decision to its owner",
        ));
    }
    Ok(())
}
pub async fn conversation(
    coordination: &impl Coordination,
    matrix: &impl Matrix,
    profile: &Profile,
    stop: CancellationToken,
) -> Result<String> {
    let value = coordination
        .call(
            &Call::agent(OperationId::OwnerConversation, &profile.id),
            stop.clone(),
        )
        .await?;
    let room = check::room_id(value.get("roomId").ok_or_else(|| {
        Failure::new(
            ErrorCode::Invalid,
            "Owner conversation response has no room identity",
        )
    })?)?;
    authorize(coordination, matrix, profile, stop).await?;
    Ok(room)
}
