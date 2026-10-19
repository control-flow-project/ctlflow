use crossfire_domain::messaging_client::{
    MessageFeed, MessagePage, MessagePageRequest, MessagingClient,
};
use crossfire_kernel::Result;
use std::collections::BTreeSet;
use tokio_util::sync::CancellationToken;

pub fn room_quota(limit: usize, rooms: usize, position: usize) -> usize {
    (limit / rooms.max(1) + usize::from(position < limit % rooms.max(1))).max(if limit == 100 {
        10
    } else {
        1
    })
}
pub async fn joined(
    client: &impl MessagingClient,
    stop: CancellationToken,
) -> Result<BTreeSet<String>> {
    client.joined_rooms(stop).await
}
pub async fn history(
    client: &impl MessagingClient,
    room: &str,
    request: &MessagePageRequest,
    stop: CancellationToken,
) -> Result<MessagePage> {
    client.history(room, request, stop).await
}
pub async fn sync(
    client: &impl MessagingClient,
    since: Option<&str>,
    timeout: u64,
    stop: CancellationToken,
) -> Result<MessageFeed> {
    client.synchronize(since, timeout, stop).await
}
