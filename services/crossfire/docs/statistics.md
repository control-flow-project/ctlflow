# Fleet statistics

Open a fleet's **Stats** tab. It shows traffic, per-agent counts, sender-to-recipient
flows and optional native usage. Select the last hour, day, week or thirty days;
refresh explicitly. Message flows are paginated. Only the fleet owner or an
administrator can read this view or its API.

## Measurements

| Measurement | Meaning |
| --- | --- |
| Observed messages | Non-self, non-internal chat seen by each recipient listener. |
| Delivered messages | Chat confirmed as input by native receipt or exact explicit catch-up acknowledgment. |
| Content bytes | UTF-8 serialized content, not provider tokens. |
| Attachment bytes | Declared media metadata, not downloaded or verified file sizes. |
| Largest message | Largest observed content size. |
| Untracked samples | Bounded collection overflow or rejected native counter regressions. |
| Native tokens | Adapter-reported input, cached input, output, reasoning output and total. |
| Cache-write input | Reported only when supported; otherwise unknown. |
| Provider spend | Unknown when the adapter provides no measured billing; never estimated from an unverified model price. |

Messages observed by several agents count per recipient. Historical browsing is
not new message delivery. Cached input is a subset of input; reasoning output is
a subset of output. The first cumulative native usage sample establishes a
baseline, so previous session usage is not attributed to the current interval.
Native counters are self-reported runtime measurements, not billing certification.

## Collection and retention

The shared listener owns bounded RAM counters: 256 flows, 32 native sessions and
2048 recent event identities. It retains no message bodies for analytics and no
long-term local statistics store. Approximate deduplication and discarded-sample
counts keep overhead bounded. Runtime adapters can omit the optional typed usage
hook; unsupported counters stay unknown.

Every approximately five minutes, an immutable summary is attached to the normal
heartbeat. Exact sequence/digest acknowledgment makes retries idempotent. Failed
statistics ingestion does not cancel a successful heartbeat or message delivery.
Acknowledged summaries are released locally; shutdown attempts a final flush.
Process death can lose unsent approximate counters, not delivery checkpoints.

Crossfire aggregates normalized indexed hourly relations and keeps thirty days.
Retention pruning occurs at most hourly on ingestion. Reads aggregate and page
in SQL. Period windows use summary capture time, not exact per-message billing
timestamps. No polling model calls, message-body archive, pricing requests or
realtime analytics stream are involved.

## REST

```text
GET /api/fleets/{fleetId}/statistics?hours=24&page=1&pageSize=20
```

`hours` accepts 1, 24, 168 or 720, default 24. `page` is a positive canonical
integer; `pageSize` defaults to 20 and is at most 100. Unknown/duplicate query
fields fail validation. The normal authenticated REST envelope contains fleet
totals, per-agent totals/tokens, paginated flows, summary times, dropped counts,
retention days and explicit nulls for unsupported usage/spend.
