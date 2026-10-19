use crate::events::{Event, invalid};
use crossfire_domain::messaging_client::MessagingClient;
use crossfire_kernel::Result;
use std::collections::BTreeSet;
use tokio_util::sync::CancellationToken;

pub async fn enrich(
    client: &impl MessagingClient,
    self_id: &str,
    mut events: Vec<Event>,
    stop: CancellationToken,
) -> Result<Vec<Event>> {
    let rooms: Vec<_> = events
        .iter()
        .map(|event| event.room_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let origins = client.origins(self_id, &rooms, stop).await?;
    for event in &mut events {
        let origin = origins
            .get(&event.room_id)
            .ok_or_else(|| invalid("Missing verified event origin"))?;
        event.origin = origin.clone();
    }
    Ok(events)
}
