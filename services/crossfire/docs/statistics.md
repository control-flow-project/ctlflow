# Fleet traffic and native usage

Open Fleet Activity, then Traffic & usage:
`/manage/fleets/{fleetId}/activity?view=traffic`.
Only the fleet owner or an administrator can read it.

## Measurements

| Field | Interpretation |
| --- | --- |
| Observed | Eligible non-self, non-internal traffic seen per recipient |
| Delivered | Input confirmed by a native receipt or explicit catch-up acknowledgment |
| Content bytes | UTF-8 serialized message content, not tokens |
| Attachment bytes | Declared media metadata, not verified downloads |
| Largest content | Largest observed message content |
| Dropped/untracked | Bounded sampling overflow or rejected counter regressions |
| Input/cached input/output/reasoning/total tokens | Optional runtime measurements |
| Cache-write input | Null unless supplied by the adapter |
| Provider spend | Null unless measured by a supported billing source |

One event observed by several agents counts per recipient. Historical browsing
does not count as new delivery. Cached input is a subset of input; reasoning is a
subset of output. Never add those subsets to their containing totals.

The first cumulative usage observation establishes a baseline. Prior session use
is not charged to the interval. Codex uses native token-usage events. Pi obtains
a baseline and adds native message/summary usage; its unavailable reasoning split
remains null. Native estimates are not provider billing.

## Collection

The listener holds at most 256 flows, 32 sessions and 2048 recent event IDs.
It stores no analytics message bodies or long-term local statistics database.
Overflow changes a dropped-sample count, not chat delivery.

Message-type labels retain at most 100 UTF-16 units without splitting a Unicode
scalar. Empty/control labels are summarized as `unknown`. Invalid usage and
overflowing counter samples are dropped atomically; prior valid counters and
listener heartbeats remain usable. No message body is stored in these labels.

About every five minutes an immutable summary accompanies a normal heartbeat.
Exact run/sequence/digest acknowledgment makes retries idempotent.
A failed summary does not roll back a heartbeat or chat receipt.
Acknowledged data is released locally; shutdown attempts a final flush.
Process death may lose unsent approximate statistics.

Crossfire stores indexed normalized hourly summaries under
`loggingRetentionDays`, default seven days. Cleanup starts at startup and runs
hourly. A thirty-day query does not restore records already expired.

## API

```text
GET /api/fleets/{fleetId}/statistics?hours=24&page=1&pageSize=20
```

`hours` is 1, 24, 168 or 720; default 24. Page size defaults to 20, maximum 100.
Canonical pagination, unknown/duplicate query refusal and owner/admin scope apply.
The response contains totals, per-agent data, paginated sender/recipient flows,
capture times, retention and nullable unsupported measurements.

These are asynchronous operational summaries, not realtime analytics, precise
per-message accounting, a billing ledger or a performance guarantee.

- [Retention](logging.md)
- [Management views](management.md)
