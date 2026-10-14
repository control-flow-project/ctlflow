use crossfire_agent_core::statistics::{Collector, Event};
use crossfire_domain::statistics::{INTERVAL_MS, MAX_FLOWS, MAX_SESSIONS, Tokens, Usage};
use std::sync::Arc;

fn event(id: &str) -> Event<'_> {
    Event {
        room_id: "!room:example",
        sender: "@human:example",
        event_id: id,
        message_type: "m.text",
        content_bytes: 100,
        attachment_bytes: 500,
        room_message: true,
        listener_notice: false,
    }
}

#[test]
fn statistics_are_bounded_interval_summaries_with_exact_pending_batch_identity_not_real_time_writes()
-> Result<(), Box<dyn std::error::Error>> {
    let mut collector = Collector::new("@self:example", 10_000);
    collector.record(&event("first"), false);
    collector.record(&event("first"), false);
    collector.record(&event("first"), true);
    collector.record(&event("first"), true);
    assert!(collector.batch(10_001, false).is_none());
    let batch = collector
        .batch(10_000 + INTERVAL_MS, false)
        .ok_or("Scheduled batch")?;
    assert_eq!(batch.flows.len(), 1);
    let totals = &batch.flows[0].totals;
    assert_eq!(
        (
            totals.observed,
            totals.delivered,
            totals.content_bytes,
            totals.delivered_bytes,
            totals.attachment_bytes,
            totals.largest_bytes
        ),
        (1, 1, 100, 100, 500, 100)
    );
    collector.record(&event("second"), true);
    assert!(Arc::ptr_eq(
        &batch,
        &collector
            .batch(10_000 + 2 * INTERVAL_MS, false)
            .ok_or("Original pending batch")?
    ));
    collector.acknowledge(&Arc::new((*batch).clone()));
    assert!(Arc::ptr_eq(
        &batch,
        &collector
            .batch(10_000 + 2 * INTERVAL_MS, false)
            .ok_or("Unacknowledged exact batch")?
    ));
    collector.acknowledge(&batch);
    let next = collector
        .batch(10_000 + 2 * INTERVAL_MS, false)
        .ok_or("Next batch")?;
    assert_eq!(next.sequence, 2);
    assert_eq!(next.flows[0].totals.delivered, 1);
    Ok(())
}
#[test]
fn exhausted_telemetry_capacity_or_malformed_counts_never_fail_message_delivery()
-> Result<(), Box<dyn std::error::Error>> {
    let mut collector = Collector::new("@self:example", 0);
    for count in 0..=MAX_FLOWS {
        let id = format!("event-{count}");
        let room = format!("!room-{count}:example");
        let mut event = event(&id);
        event.room_id = &room;
        collector.record(&event, true);
    }
    for count in 0..=MAX_SESSIONS {
        collector.usage(&Usage {
            runtime: "pi".to_owned(),
            session_id: format!("session-{count}"),
            tokens: Tokens::default(),
        });
    }
    let mut bad = event("invalid");
    bad.content_bytes = -1;
    collector.record(&bad, true);
    let batch = collector
        .batch(INTERVAL_MS, false)
        .ok_or("Bounded summary")?;
    assert_eq!(batch.flows.len(), MAX_FLOWS);
    assert_eq!(batch.usage.len(), MAX_SESSIONS);
    assert_eq!(batch.dropped, 3);
    Ok(())
}
