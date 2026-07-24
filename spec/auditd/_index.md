---
title: auditd
weight: 80
---

`auditd` owns authoritative kernel security and activity evidence.

## Owns

| Record | Meaning |
| --- | --- |
| Audit event | One immutable attributable action or outcome |
| Payload deletion event | Immutable evidence that retained detail was removed |
| Audit export | Bounded asynchronous extraction of Audit Events |

It serves read-only `auditevents` and mutable `auditexports` in
`audit.ctlflow.com/v1alpha1`.

## Activities

- Ingest idempotent evidence batches from authenticated kernel services.
- Preserve the Kubernetes subject for operator actions or Actor and attached account for product
  actions, plus immediate caller, runtime principal, and delegation identity when applicable.
- Preserve Tenant, Workspace, Placement, Package, App, Job, Run, invocation-token, trace, and span
  references when applicable.
- Store bounded action, target, outcome, reason, timing, and typed detail.
- Query global or exact Tenant partitions with bounded time and pagination.
- Stream finite authorized tails from an explicit cursor.
- Apply configured retention.
- Redact or hard-delete legally prohibited retained payload detail while preserving its commitment.
- Append immutable evidence of every payload deletion.
- Create, inspect, expire, and authorize bounded exports.

## Evidence flow

Every durable service commits its domain mutation and audit-outbox envelope in one transaction:

```text
 service database transaction
   +-- domain mutation
   +-- audit outbox row
          |
          | idempotent authenticated batch
          v
       auditd
```

An accepted source identity and idempotency key map to one event. Retrying the outbox cannot
duplicate evidence. A source service never holds its transaction while calling `auditd`.

Runtime proxies and mediation services emit decision evidence correlated by invocation-token,
trace, and span identity. Application workloads cannot submit authoritative kernel events directly.

## Identity

Automated activity distinguishes all material identities:

```text
actor             virtual principal for Job
attached account  service User bounding that Job
immediate caller  concrete Run
runtime principal exact process
requester         user, service, or product automation that requested Run
placement         execution and state boundary
```

Requester attribution never replaces the Actor.

## Content boundary

Audit detail may contain bounded identifiers, operation names, policy reasons, state transitions,
and status classes. It may not contain:

- credentials or secret material;
- request or response bodies;
- application records or file contents;
- model prompts or model responses;
- object bytes; or
- program log streams.

Program logs remain in the configured log system and are exposed through `execd`. Kubernetes audit
remains Kubernetes evidence.

OpenTelemetry traces, metrics, and logs are operational and may be sampled or dropped. They can
correlate with an Audit Event by trace and span identity but can never create, replace, acknowledge,
or satisfy authoritative evidence.

## Retention, deletion, and integrity

Audit Events are immutable. Retention may remove expired events according to partition policy.

When retained detail must be removed immediately, `auditd` hard-deletes the prohibited payload,
preserves its digest commitment and immutable envelope, and appends a new payload-deletion event
containing authorizer, reason, time, and target event. Sequence verification therefore proves that
content was deliberately removed without retaining the prohibited content.

An ordinary domain deletion can never erase audit evidence silently.

## Direct operations

| Operation | Admitted caller | Purpose |
| --- | --- | --- |
| RecordAuditBatch | kernel service or trusted runtime proxy | Ingest one finite idempotent source batch |
| QueryAuditEvents | authorized operator or product backend | Return one bounded page from one exact partition and time range |
| CountAuditEvents | authorized operator or product backend | Return one bounded count for the same query grammar |
| FollowAuditEvents | authorized operator or product backend | Stream finite events after an explicit cursor |
| CreateAuditExport | authorized operator or product backend | Start one bounded asynchronous export |
| GetAuditExport | authorized export owner | Return export state and bounded metadata |
| AuthorizeAuditExportTransfer | authorized export owner | Return one short-lived transfer for a completed export |
| RedactAuditPayload | specifically authorized legal operator | Replace admitted detail with an irreversible redacted marker |
| DeleteAuditPayload | specifically authorized legal operator | Hard-delete admitted detail and append deletion evidence |
| Health | private Kubernetes probe | Report whether the process is live |
| Ready | private Kubernetes probe | Report whether persistence, ingestion, and finite-outbox capacity permit work |

### Ingestion contract

`RecordAuditBatch` receives a finite ordered batch under one authenticated source service and source
generation. Every envelope contains:

```text
source event ID and idempotency key
source operation and occurred time
operator Kubernetes subject, or Actor and attached account
immediate caller and runtime principal when applicable
Tenant/global partition and other bounded owner references
invocation-token, trace, and span references when applicable
outcome and stable reason
typed bounded detail
optional bounded removable payload plus commitment
```

The authenticated workload determines source service; the body cannot name another source.
`auditd` validates event kind and typed-detail schema registered for that source operation. One
source and event ID maps permanently to one canonical envelope. Exact replay returns the existing
acceptance; different content is `ALREADY_EXISTS`. A batch commits atomically in source order or
rejects without a partial prefix. The result lists accepted event IDs and the resulting partition
cursor.

Durable services write an outbox row with their domain mutation, then retry until accepted.
Stateless `authd`, `edged`, and `egressd` submit an admission event before returning authentication
success, opening a target or upstream connection, or otherwise making an allow externally
effective. If acceptance cannot be established within the request deadline, admission fails
unavailable. A denial remains fail-closed; its public response may be generalized to unavailable
when required evidence cannot be accepted.

The mediator submits a separately correlated outcome event before cleanly completing an ordinary
finite exchange. A process failure or forced stream termination may leave only the accepted
admission event. Queries expose that unresolved fact; `auditd` never infers or manufactures a
completion outcome.

### Query and stream contract

Queries require exactly one global or Tenant partition, inclusive start time, exclusive end time,
finite page size, and optional indexed source, operation, outcome, Actor, target kind/ID, App, Job,
Run, or trace selectors. The interval has an installation maximum. Ordering is occurred time then
immutable Audit Event ID. The opaque continuation binds partition, complete query, authorization
fence, ordering, and snapshot revision.

`CountAuditEvents` accepts the same grammar and returns an exact count only within the configured
finite count bound; a wider request is `RESOURCE_EXHAUSTED` and must use an export. Follow begins
after an explicit partition cursor, authorizes every emitted event, and ends at deadline, finite
event/byte limit, retention gap, or caller cancellation. A retention gap returns the earliest
available cursor rather than silently skipping.

### Export contract

An export fixes owner partition, query, selected typed fields, output format, retention expiry,
configuration revision, and idempotency identity. It never spans global and Tenant partitions in
one artifact. Export workers page through the same authorized query, write to the configured
storage binding, commit length/digest metadata, and expose no bytes in the resource.

Transfer authorization binds caller, export, digest, method, byte bound, and short expiry. Expired,
failed, or superseded exports have no transfer. Deleting an export removes the external artifact
under its retention policy but does not delete source Audit Events.

### Payload-removal contract

Redaction and hard deletion require event ID, expected event revision, bounded legal reason,
authorizing operation identity, and idempotency key. Redaction replaces removable detail with a
fixed marker and preserves the original commitment. Hard deletion removes the payload bytes and
all searchable payload-derived fields while retaining the immutable envelope and commitment. Both
append a separate deletion event in the same transaction.

Repeating the same operation returns the existing deletion event. A different removal after payload
absence is `FAILED_PRECONDITION`; a revision race is `ABORTED`. No removal operation changes Actor,
source, target, outcome, time, sequence, commitment, or another event.

## Administrative resources

Audit Events are read-only resources partitioned by global or exact Tenant owner. Their metadata
and envelope are immutable. Removable detail is exposed only to a caller authorized for both the
event and its payload class. Audit Exports are mutable only through creation, observed worker
state, expiry, transfer, and deletion subresources. Lists require a bounded time range and use the
common pagination contract.

Retention configuration belongs to `configd`; `auditd` records the applied revision. Retention
removes an expired event or export according to partition policy and records bounded maintenance
evidence. Legal payload deletion is independent of ordinary retention.

## Callers and dependencies

| Callee | Purpose |
| --- | --- |
| `tenantd` | Validate exact Tenant partition and lifecycle |
| `identityd` | Resolve current query Actor, account, and principal facts |
| `policyd` | Authorize query, export, and payload-removal operations |
| `configd` | Resolve retention and exact export-storage configuration |
| `egressd` | Reach configured export storage only when its binding uses external HTTP |

Every other kernel service calls only `RecordAuditBatch`. Applications cannot submit authoritative
kernel evidence. Export storage and transfer providers remain dependencies; `auditd` stores only
metadata and commitments.

## Verification

Canonical evidence covers source authentication/spoofing, typed envelope validation, exact replay
and conflicting replay, atomic batch order, durable outbox restart, stateless allow backpressure,
global/Tenant separation, every indexed query and continuation fence, count bounds, follow
backpressure and retention gaps, export idempotency/restart/failure/expiry/transfer confinement,
redaction and hard deletion commitments, concurrent removal, retention, cross-Tenant invisibility,
dependency outage, cancellation, telemetry separation/redaction, and proof that no secret, body,
application record, file, prompt, model response, or program log enters evidence.

## Invariants

- An accepted event is immutable and attributable to one authenticated source action.
- Tenant callers cannot query another Tenant partition.
- Global evidence is distinct from Tenant partitions.
- Export APIs return metadata and purpose-bound transfer access, not export bytes.
- Audit unavailability cannot silently discard committed source evidence.
- Payload removal always leaves immutable deletion evidence and the original commitment.
- Telemetry loss or export success has no effect on audit acceptance or retention.
