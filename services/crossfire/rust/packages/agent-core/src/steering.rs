use crate::{
    coordination::{self, Coordination},
    events::Event,
    profile::Profile,
};
use crossfire_contracts::notices;
use crossfire_domain::messaging_client::MessagingClient;
use crossfire_kernel::Result;
use std::collections::BTreeSet;
use tokio_util::sync::CancellationToken;

pub fn source(event: &Event) -> Result<crossfire_domain::messaging::BackendEvent> {
    Ok(crossfire_domain::messaging::BackendEvent {
        event_id: event.event_id.clone(),
        room_id: event.room_id.clone(),
        sender_backend_user_id: event.sender.clone(),
        event_type: event.kind.code().to_owned(),
        message_type: Some(event.content.kind.code().to_owned()),
        body: event.content.body.clone(),
        mentions: event.content.mentions.clone(),
        edited: event.content.edited,
        control: event.content.control,
    })
}
pub async fn authorized(
    messaging: &impl MessagingClient,
    coordination: &impl Coordination,
    profile: &Profile,
    event: &Event,
    senders: &BTreeSet<String>,
    stop: CancellationToken,
) -> Result<bool> {
    let source = source(event)?;
    if source.event_type != "message"
        || source.message_type.as_deref() != Some("text")
        || source.body.is_none()
        || source.edited
        || source.control
        || source.sender_backend_user_id == profile.account.user_id
    {
        return Ok(false);
    }
    let mention = notices::mentions_agent(&source, &profile.account.user_id);
    let pause = source.sender_backend_user_id == profile.settings.owner
        && source
            .body
            .as_deref()
            .is_some_and(|body| body.trim() == "!!");
    let direct = event.origin.kind == crossfire_domain::messaging_client::OriginKind::Dm;
    if !pause && (!senders.contains(&event.sender) || !mention && !direct) {
        return Ok(false);
    }
    let identities =
        coordination::senders(coordination, std::slice::from_ref(event), stop.clone()).await?;
    if identities
        .get(&event.sender)
        .is_none_or(|identity| identity.kind.is_none())
    {
        return Ok(false);
    }
    let joined = messaging.joined_members(&event.room_id, stop).await?;
    Ok(joined.contains(&event.sender)
        && joined.contains(&profile.account.user_id)
        && (mention || (pause || direct) && joined.len() == 2))
}
