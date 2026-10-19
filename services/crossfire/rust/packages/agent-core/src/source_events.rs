use crate::{
    events::{self, Event, invalid},
    local_state::LocalState,
    receive_pages, receive_snapshots, receive_state,
};
use crossfire_domain::messaging_client::{
    Direction, EventFilter, EventType, MessageFeed, MessagePageRequest, MessagingClient,
};
use crossfire_kernel::Result;
use std::{collections::BTreeSet, future::Future};
use tokio_util::sync::CancellationToken;

pub async fn incremental<F, V>(
    client: &impl MessagingClient,
    feed: MessageFeed,
    since: Option<&str>,
    kind: EventType,
    stop: CancellationToken,
    mut visit: V,
) -> Result<()>
where
    F: Future<Output = Result<()>> + Send,
    V: FnMut(Event) -> F,
{
    let Some(since) = since else {
        return Ok(());
    };
    for (room, timeline) in feed.rooms {
        let mut seen = BTreeSet::new();
        if timeline.limited {
            let mut from = since.to_owned();
            let mut positions = BTreeSet::new();
            loop {
                let page = receive_pages::history(
                    client,
                    &room,
                    &MessagePageRequest {
                        direction: Direction::Forward,
                        from: Some(from.clone()),
                        to: Some(feed.cursor.clone()),
                        limit: 100,
                        filter: Some(EventFilter {
                            types: Some(vec![kind]),
                            senders: None,
                        }),
                    },
                    stop.clone(),
                )
                .await?;
                let count = page.events.len();
                for value in page.events {
                    let event = events::take(value, &room)?;
                    if seen.insert(event.event_id.clone()) {
                        visit(event).await?;
                    }
                }
                if count == 0 || page.end.as_deref() == Some(&feed.cursor) {
                    break;
                }
                from = page.end.ok_or_else(|| {
                    invalid("Limited synchronization history has no continuation")
                })?;
                if !positions.insert(from.clone()) {
                    return Err(invalid(
                        "Limited synchronization history repeated a continuation",
                    ));
                }
            }
        }
        for value in timeline.events {
            if value.event_type == kind {
                let event = events::take(value, &room)?;
                if seen.insert(event.event_id.clone()) {
                    visit(event).await?;
                }
            }
        }
    }
    Ok(())
}
pub fn reset_rooms(storage: &impl LocalState, file: &str, reset: &BTreeSet<String>) -> Result<()> {
    let mut cursors = receive_state::load(storage, file)?;
    for room in reset {
        cursors.remove(room);
    }
    receive_snapshots::retire(storage, file, reset)?;
    receive_state::retain_joined(storage, file, &cursors.keys().cloned().collect())?;
    if let Some(mut wake) = receive_snapshots::load_wake(storage, file)? {
        for room in reset {
            wake.ends.remove(room);
        }
        receive_snapshots::save_wake(
            storage,
            file,
            (!wake.ends.is_empty() && !reset.contains(&wake.room)).then_some(&wake),
        )?;
    }
    Ok(())
}
