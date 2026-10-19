use crate::{
    coordination::{self, Coordination},
    profile::Profile,
};
use crossfire_contracts::{call::Call, operations::OperationId, validation as check};
use crossfire_domain::messaging_client::MessagingClient;
use crossfire_kernel::{Failure, Result, failure::ErrorCode};

use tokio_util::sync::CancellationToken;

pub async fn authorize(
    coordination: &impl Coordination,
    messaging: &impl MessagingClient,
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
    messaging
        .verify_private_conversation(
            room,
            &profile.settings.owner,
            &profile.account.user_id,
            stop,
        )
        .await
}
pub async fn conversation(
    coordination: &impl Coordination,
    messaging: &impl MessagingClient,
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
    authorize(coordination, messaging, profile, stop).await?;
    Ok(room)
}
