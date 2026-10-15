use crossfire_agent_core::receiver_gate::Gate;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn idle_watches_and_read_only_acquisition_do_not_block_queries_but_native_publication_does()
-> Result<(), Box<dyn std::error::Error>> {
    let gate = Gate::default();
    let query = gate.query(CancellationToken::new(), true)?;
    assert!(!gate.publishing()?);
    assert!(gate.publication().is_err());
    let cancelled = query.cancellation();
    gate.interrupt_query()?;
    cancelled.cancelled().await;
    assert!(query.check().is_err());
    drop(query);
    let publication = gate.publication()?;
    assert!(gate.publishing()?);
    assert!(gate.query(CancellationToken::new(), true).is_err());
    let history = gate.query(CancellationToken::new(), false)?;
    history.check()?;
    drop(history);
    assert!(gate.publication().is_err());
    drop(publication);
    let query = gate.query(CancellationToken::new(), true)?;
    query.check()?;
    Ok(())
}
#[test]
fn already_started_acknowledgments_finish_before_new_steering_without_allowing_new_unread_queries()
-> Result<(), Box<dyn std::error::Error>> {
    let gate = Gate::default();
    gate.pending(true)?;
    assert!(gate.query(CancellationToken::new(), true).is_err());
    let acknowledgment = gate.acknowledgment(CancellationToken::new())?;
    assert!(gate.publication().is_err());
    acknowledgment.check()?;
    drop(acknowledgment);
    let publication = gate.publication()?;
    assert!(gate.acknowledgment(CancellationToken::new()).is_err());
    drop(publication);
    Ok(())
}
