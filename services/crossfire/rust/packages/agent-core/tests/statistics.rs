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
fn telemetry_labels_and_usage_share_native_unicode_bounds_without_runtime_whitelists()
-> Result<(), Box<dyn std::error::Error>> {
    let mut collector = Collector::new("@self:example", 0);
    let labels = [
        format!("{}😀suffix", "a".repeat(99)),
        "😀".repeat(51),
        String::new(),
        "\n".to_owned(),
    ];
    for (index, label) in labels.iter().enumerate() {
        let id = format!("event-{index}");
        let mut value = event(&id);
        value.message_type = label;
        collector.record(&value, true);
    }
    let usage = Usage {
        runtime: "custom-adapter".to_owned(),
        session_id: format!("{}a", "😀".repeat(127)),
        tokens: Tokens::default(),
    };
    collector.usage(&usage);
    collector.usage(&Usage {
        session_id: "😀".repeat(128),
        ..usage.clone()
    });
    collector.usage(&Usage {
        runtime: "invalid\n".to_owned(),
        ..usage
    });
    let batch = collector
        .batch(INTERVAL_MS, true)
        .ok_or("Bounded native batch")?;
    assert_eq!(batch.dropped, 2);
    assert_eq!(batch.usage.len(), 1);
    assert_eq!(batch.usage[0].runtime, "custom-adapter");
    assert_eq!(
        batch
            .flows
            .iter()
            .map(|value| (value.message_type.clone(), value.totals.delivered))
            .collect::<Vec<_>>(),
        vec![
            ("a".repeat(99), 1),
            ("unknown".to_owned(), 2),
            ("😀".repeat(50), 1)
        ]
    );
    Ok(())
}

#[test]
fn telemetry_overflow_preserves_the_last_valid_counters() -> Result<(), Box<dyn std::error::Error>>
{
    let mut collector = Collector::new("@self:example", 0);
    let mut first = event("first");
    first.attachment_bytes = 9_007_199_254_740_991;
    collector.record(&first, true);
    let mut second = event("second");
    second.attachment_bytes = 1;
    collector.record(&second, true);
    let batch = collector.batch(INTERVAL_MS, true).ok_or("Valid summary")?;
    assert_eq!(batch.dropped, 1);
    assert_eq!(batch.flows[0].totals.observed, 1);
    assert_eq!(batch.flows[0].totals.delivered, 1);
    assert_eq!(
        batch.flows[0].totals.attachment_bytes,
        9_007_199_254_740_991
    );
    Ok(())
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
