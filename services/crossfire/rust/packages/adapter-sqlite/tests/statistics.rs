mod support;

use crossfire_adapter_sqlite::tables::{listener_stat_checkpoint, runtime_usage_checkpoint};
use crossfire_domain::{
    listener,
    port::{ListenerRepository, UnitOfWork},
    statistics::*,
};
use crossfire_kernel::failure::ErrorCode;
use diesel::prelude::*;
use support::{NOW, Scenario};

fn batch(sequence: i64) -> Batch {
    Batch {
        sequence,
        started_at: NOW,
        ended_at: NOW + 1,
        dropped: 0,
        flows: vec![Flow {
            room_id: "!room:example.test".to_owned(),
            sender_backend_user_id: "@sender:example.test".to_owned(),
            message_type: "m.text".to_owned(),
            totals: Totals {
                observed: 2,
                delivered: 1,
                content_bytes: 100,
                delivered_bytes: 40,
                attachment_bytes: 0,
                largest_bytes: 60,
            },
        }],
        usage: vec![Usage {
            runtime: "codex".to_owned(),
            session_id: "session".to_owned(),
            tokens: Tokens {
                input: 100,
                cached_input: 40,
                cache_write_input: None,
                output: 20,
                reasoning_output: Some(5),
                total: 120,
            },
        }],
    }
}

#[test]
fn invalid_stored_usage_cannot_panic_or_cancel_message_delivery()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    scenario.report.statistics = Some(batch(1));
    assert!(
        listener::report(
            &mut scenario.store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &scenario.report,
            "release-current",
            NOW
        )?
        .statistics_accepted
    );
    let mut database = scenario.database()?;
    diesel::update(runtime_usage_checkpoint::table)
        .set(runtime_usage_checkpoint::input.eq(i64::MIN))
        .execute(database.connection())?;
    scenario.report.statistics = Some(batch(2));
    scenario.report.messages_delivered = 3;
    let outcome = listener::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report,
        "release-current",
        NOW + 1,
    )?;
    assert!(!outcome.statistics_accepted);
    assert_eq!(
        scenario
            .store
            .listener_run(&scenario.report.run_id)?
            .ok_or("Missing run")?
            .messages_delivered,
        3
    );
    assert_eq!(
        listener_stat_checkpoint::table
            .select(listener_stat_checkpoint::sequence)
            .first::<i64>(database.connection())?,
        1
    );
    Ok(())
}

#[test]
fn listener_statistics_retries_are_exact_and_invalid_statistics_do_not_cancel_heartbeats()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let guest = scenario.add_human("@guest:example.test")?;
    scenario.report.statistics = Some(batch(1));
    assert!(
        listener::report(
            &mut scenario.store,
            &guest,
            &scenario.agent.principal_id,
            &scenario.report,
            "release-current",
            NOW
        )
        .is_err()
    );
    let first = listener::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report,
        "release-current",
        NOW,
    )?;
    assert!(first.statistics_accepted);
    let retry = listener::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report,
        "release-current",
        NOW + 1,
    )?;
    assert!(retry.statistics_accepted);
    let ids = [scenario.agent.principal_id.clone()];
    let measured = scenario.store.statistics(&ids, NOW, 1, 20)?;
    assert_eq!(measured.intervals, 1);
    assert_eq!(measured.totals.observed, 2);
    assert_eq!(measured.tokens.as_ref().ok_or("Missing tokens")?.input, 0);
    assert!(
        measured
            .tokens
            .as_ref()
            .ok_or("Missing tokens")?
            .cache_write_input
            .is_none()
    );
    let mut conflicting = batch(1);
    conflicting.flows[0].totals.observed = 3;
    scenario.report.statistics = Some(conflicting);
    scenario.report.messages_delivered = 2;
    let invalid = listener::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report,
        "release-current",
        NOW + 2,
    )?;
    assert!(!invalid.statistics_accepted);
    let run = scenario
        .store
        .listener_run(&scenario.report.run_id)?
        .ok_or("Missing run")?;
    assert_eq!(run.last_seen_at, NOW + 2);
    assert_eq!(run.messages_delivered, 2);
    assert_eq!(
        scenario.store.statistics(&ids, NOW, 1, 20)?.totals.observed,
        2
    );
    let mut second = batch(2);
    second.usage[0].tokens = Tokens {
        input: 200,
        cached_input: 80,
        cache_write_input: None,
        output: 40,
        reasoning_output: Some(10),
        total: 240,
    };
    scenario.report.statistics = Some(second);
    assert!(
        listener::report(
            &mut scenario.store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &scenario.report,
            "release-current",
            NOW + 3
        )?
        .statistics_accepted
    );
    let measured = scenario.store.statistics(&ids, NOW, 1, 20)?;
    assert_eq!(measured.totals.observed, 4);
    let tokens = measured.tokens.ok_or("Missing tokens")?;
    assert_eq!(tokens.input, 100);
    assert_eq!(tokens.cached_input, 40);
    assert_eq!(tokens.output, 20);
    assert_eq!(tokens.reasoning_output, Some(5));
    assert_eq!(tokens.total, 120);
    let mut decreasing = batch(3);
    decreasing.usage[0].tokens.input = 10;
    scenario.report.statistics = Some(decreasing);
    assert!(
        listener::report(
            &mut scenario.store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &scenario.report,
            "release-current",
            NOW + 4
        )?
        .statistics_accepted
    );
    let measured = scenario.store.statistics(&ids, NOW, 1, 20)?;
    assert_eq!(measured.dropped, 1);
    assert_eq!(measured.tokens.ok_or("Missing tokens")?.input, 100);
    let mut database = scenario.database()?;
    assert_eq!(
        runtime_usage_checkpoint::table
            .select(runtime_usage_checkpoint::input)
            .first::<i64>(database.connection())?,
        200
    );
    scenario.report.stopped = true;
    assert!(
        listener::report(
            &mut scenario.store,
            &scenario.agent,
            &scenario.agent.principal_id,
            &scenario.report,
            "release-current",
            NOW + 5
        )?
        .statistics_accepted
    );
    scenario.report.stopped = false;
    scenario.report.statistics = Some(batch(4));
    let closed = listener::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report,
        "release-current",
        NOW + 6,
    )?;
    assert!(closed.closed);
    assert!(!closed.statistics_accepted);
    assert_eq!(
        scenario.store.statistics(&ids, NOW, 1, 20)?.totals.observed,
        6
    );
    Ok(())
}

#[test]
fn statistics_aggregate_in_sql_with_bounded_pages_hour_buckets_and_unknown_usage()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let mut first = batch(1);
    first.usage.clear();
    scenario.store.transaction(|store| {
        store.record_statistics(
            &scenario.agent.principal_id,
            &scenario.report.run_id,
            &first,
            NOW,
        )
    })?;
    let mut second = batch(2);
    second.usage.clear();
    second.flows[0].room_id = "!images:example.test".to_owned();
    second.flows[0].message_type = "m.image".to_owned();
    second.flows[0].totals.observed = 8;
    second.flows[0].totals.attachment_bytes = 512;
    second.flows[0].totals.largest_bytes = 4096;
    let later = NOW + 3_600_000;
    scenario.store.transaction(|store| {
        store.record_statistics(
            &scenario.agent.principal_id,
            &scenario.report.run_id,
            &second,
            later,
        )
    })?;
    let ids = [scenario.agent.principal_id.clone()];
    let measured = scenario.store.statistics(&ids, NOW, 1, 1)?;
    assert_eq!(measured.intervals, 2);
    assert_eq!(measured.totals.observed, 10);
    assert_eq!(measured.totals.largest_bytes, 4096);
    assert_eq!(measured.total_flows, 2);
    assert_eq!(measured.flows.len(), 1);
    assert_eq!(measured.flows[0].flow.message_type, "m.image");
    assert!(measured.tokens.is_none());
    assert!(measured.agents[0].tokens.is_none());
    assert_eq!(measured.first_report_at, Some(NOW));
    assert_eq!(measured.last_report_at, Some(later));
    let second_page = scenario.store.statistics(&ids, NOW, 2, 1)?;
    assert_eq!(second_page.flows[0].flow.message_type, "m.text");
    assert_eq!(second_page.totals.observed, 10);
    let beyond = scenario.store.statistics(&ids, NOW, 3, 1)?;
    assert!(beyond.flows.is_empty());
    assert_eq!(beyond.total_flows, 2);
    let recent = scenario.store.statistics(&ids, NOW + 1, 1, 20)?;
    assert_eq!(recent.totals.observed, 8);
    assert_eq!(recent.intervals, 1);
    let empty = scenario.store.statistics(&[], NOW, 1, 20)?;
    assert_eq!(empty.intervals, 0);
    assert!(empty.flows.is_empty());
    assert!(empty.first_report_at.is_none());
    Ok(())
}

#[test]
fn overflowing_statistics_roll_back_all_rows_but_preserve_the_delivery_report()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let mut scenario = Scenario::create()?;
    let mut first = batch(1);
    first.usage.clear();
    first.flows[0].totals.content_bytes = 9_007_199_254_740_991;
    scenario.store.transaction(|store| {
        store.record_statistics(
            &scenario.agent.principal_id,
            &scenario.report.run_id,
            &first,
            NOW,
        )
    })?;
    let second = batch(2);
    let failed = scenario.store.transaction(|store| {
        store.record_statistics(
            &scenario.agent.principal_id,
            &scenario.report.run_id,
            &second,
            NOW + 1,
        )
    });
    assert_eq!(
        failed.err().map(|error| error.code),
        Some(ErrorCode::Unavailable)
    );
    let ids = [scenario.agent.principal_id.clone()];
    let measured = scenario.store.statistics(&ids, NOW, 1, 20)?;
    assert_eq!(measured.totals.observed, 2);
    assert_eq!(measured.last_report_at, Some(NOW));
    let mut database = scenario.database()?;
    assert_eq!(
        listener_stat_checkpoint::table
            .select(listener_stat_checkpoint::sequence)
            .first::<i64>(database.connection())?,
        1
    );
    assert_eq!(
        runtime_usage_checkpoint::table
            .count()
            .get_result::<i64>(database.connection())?,
        0
    );
    scenario.report.statistics = Some(second);
    scenario.report.messages_delivered = 10;
    let outcome = listener::report(
        &mut scenario.store,
        &scenario.agent,
        &scenario.agent.principal_id,
        &scenario.report,
        "release-current",
        NOW + 2,
    )?;
    assert!(!outcome.statistics_accepted);
    assert!(!outcome.disconnect);
    assert_eq!(
        scenario
            .store
            .listener_run(&scenario.report.run_id)?
            .ok_or("Missing run")?
            .messages_delivered,
        10
    );
    Ok(())
}
