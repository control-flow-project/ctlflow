use crossfire_adapter_matrix::room_operations::Operations;
use crossfire_domain::room_access::operations::RoomOperations;
use std::sync::Arc;

#[tokio::test]
async fn native_room_serialization_is_keyed_and_close_cancels_waiters_without_sleep_polling()
-> Result<(), Box<dyn std::error::Error>> {
    let operations = Arc::new(Operations::default());
    let first = operations.acquire("!room:example").await?;
    let different = operations.acquire("!other:example").await?;
    let (sent, received) = tokio::sync::oneshot::channel();
    let queued = Arc::clone(&operations);
    let waiting = tokio::spawn(async move {
        let _sent = sent.send(());
        queued.acquire("!room:example").await
    });
    received.await?;
    assert!(!waiting.is_finished(), "Same-room mutation cannot overlap");
    drop(first);
    let next = tokio::time::timeout(std::time::Duration::from_secs(3), waiting).await???;
    let queued = Arc::clone(&operations);
    let (sent, received) = tokio::sync::oneshot::channel();
    let waiting = tokio::spawn(async move {
        let _sent = sent.send(());
        queued.acquire("!room:example").await
    });
    received.await?;
    operations.close();
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(3), waiting)
            .await??
            .is_err()
    );
    assert!(operations.acquire("!new:example").await.is_err());
    drop(next);
    drop(different);
    Ok(())
}
