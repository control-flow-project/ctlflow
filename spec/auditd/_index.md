---
title: auditd
weight: 80
---

`auditd` is the sole authority for immutable kernel evidence that it has
accepted from an admitted source. Audit evidence is durable domain state, not
operational telemetry.

## Exact surface

The service-owned `ctlflow.audit.v1.AuditService` protobuf contract exposes
exactly one private unary RPC:

| Method | Request | Response |
| --- | --- | --- |
| `RecordAuditBatch` | One to 100 typed events | One acceptance for each request event |

The response acceptances are in request order. Each contains the exact source
event ID and that event's positive Tenant-partition cursor.

Auditd has no public listener, operator RPC, invocation-identity path, read,
list, search, export, delete, redact, watch, stream, queue, worker, retention,
cursor-management, or administration operation. The separate probe listener
serves only `/healthz` and `/readyz`. There is no HTTP mirror, CtlFlow CRD,
Kubernetes aggregated API, test-only production method, or generic payload
surface.

## Event envelope

Every request event contains exactly:

| Field | Contract |
| --- | --- |
| `source_event_id` | Exactly 32 lower-case hexadecimal characters encoding 128 source-generated random bits; the all-zero value is invalid |
| `occurred_at` | Present, valid `google.protobuf.Timestamp` for the source mutation outcome |
| `attribution` | Exactly one admitted typed attribution |
| `tenant_id` | The Tenant partition and Tenant fence for the event |
| `trace_id` | One non-zero 32-character lower-case hexadecimal W3C trace ID |
| `span_id` | One non-zero 16-character lower-case hexadecimal W3C span ID for the source operation |
| `detail` | Exactly one admitted typed detail |

Tenant IDs and Workspace IDs use the Tenantd canonical shape: one to 64
lower-case ASCII characters, starting alphanumeric, with only alphanumeric
characters, `_`, or `-` thereafter. Principal IDs use the Identityd canonical
kind prefix and local-ID grammar and are at most 256 characters. Session IDs
are exactly 32 lower-case hexadecimal characters.

`occurred_at` records source occurrence time. It does not order acceptance or
allocate a cursor. Its seconds and nanoseconds must be inside the protobuf
timestamp range; Auditd imposes no age window because an identical retry must
remain valid.

The complete encoded request, including unknown wire fields, is limited to
256 KiB. Unknown wire fields have no evidence semantics and are not persisted.
There is no caller-defined schema generation, free-form operation, generic
outcome, idempotency string, property bag, JSON, opaque bytes, or arbitrary
detail.

## Typed details

The complete detail set is:

| Detail | Fields |
| --- | --- |
| `TenantMutationAuditDetail` | Tenant operation, resulting positive revision, resulting Tenant state |
| `WorkspaceMutationAuditDetail` | Workspace ID, Workspace operation, resulting positive revision, resulting Workspace state |
| `IdentitySessionAuditDetail` | Session ID, human account principal ID, resulting positive Session revision, Session action |

Tenant operations are exactly `CREATE_TENANT`, `UPDATE_TENANT`, and
`SET_TENANT_STATE`. Workspace operations are exactly `CREATE_WORKSPACE`,
`UPDATE_WORKSPACE`, and `SET_WORKSPACE_STATE`. The resulting state is exactly
`ACTIVE`, `SUSPENDED`, or `DELETED`.

Every resource and Session revision is in the positive signed 64-bit range,
one through 9,223,372,036,854,775,807.

The typed combinations are:

- create Tenant and create Workspace require revision 1 and `ACTIVE`;
- update Tenant and update Workspace require revision at least 2 and a
  resulting state of `ACTIVE` or `SUSPENDED`;
- set-state evidence requires revision at least 2 and admits any defined
  resulting state;
- Session `CREATED` requires revision 1;
- Session `REVOKED` requires revision 2; and
- a Session account is a canonical `user:` human account, never a service or
  virtual principal.

Only evidence for a successful actual mutation is admitted. Reads, rejected
calls, create retries, no-op updates, no-op state changes, no-op Session
revocation, Session exchange, and invocation issuance have no approved detail.
There is no denied or failed outcome in the wire contract.

The common `tenant_id` is both the partition and the Tenant target for a Tenant
detail. It is the immutable parent Tenant for a Workspace detail and the
Session Tenant fence for an Identity Session detail. A detail cannot name or
imply a second Tenant.

Credentials, credential digests, provider identities, addresses, display
names, request or response bodies, invocation JWTs, signing material, headers,
secret material, and arbitrary content are not admitted evidence.

## Attribution

Attribution has exactly one of these forms:

| Form | Fields | Admitted use |
| --- | --- | --- |
| Operator | One authenticated certificate common name | Any Tenant or Workspace mutation |
| Workload | One Kubernetes ServiceAccount subject | Identity Session mutation |
| Invocation | Actor principal, subject-account principal, and immediate Kubernetes ServiceAccount subject | `UPDATE_TENANT` or any Workspace mutation |

An operator subject is the exact authenticated certificate common name. It
contains one to 253 Unicode scalar values, contains no control scalar, and is
not whitespace-only. A workload subject has the exact form:

```text
system:serviceaccount:<namespace>:<service-account>
```

Both names are lower-case Kubernetes DNS labels of one to 63 characters.

For invocation attribution, the subject account is a `user:` or `service:`
principal. A direct human or service Actor equals that subject account. An
`agent:` Actor is distinct from its subject account. Nested or unrelated Actor
chains are invalid.

Attribution is a source attestation constructed only from identity already
authenticated and validated by Tenantd or Identityd. Auditd validates its
typed shape and source/detail admission but does not accept an upstream token
or independently recreate the source service's earlier authentication
decision.

## Source authentication and admission

`RecordAuditBatch` uses private TLS and authenticates one bound Kubernetes
ServiceAccount token from the `authorization` metadata. The call contains
exactly one string value with the case-sensitive `Bearer ` scheme followed by
one to 16,384 visible ASCII token characters. Auditd validates the token's
issuer, signature, installation audience, expiry, maximum lifetime, binding,
namespace, and exact subject. It maps that concrete subject to one stable
canonical service principal.

The complete caller and detail matrix is:

| Authenticated source | Admitted detail | Admitted attribution |
| --- | --- | --- |
| `SERVICE/svc_tenantd` | Tenant mutation | Operator; invocation only for `UPDATE_TENANT` |
| `SERVICE/svc_tenantd` | Workspace mutation | Operator or invocation |
| `SERVICE/svc_identityd` | Identity Session mutation | Workload |

Installation configuration contains exactly one valid Kubernetes
ServiceAccount subject for each canonical source. Startup fails when either
mapping is absent, malformed, duplicated, or maps both principals to the same
subject.

No other workload is admitted. Auditd neither requires nor consumes an
Identityd invocation JWT. A body field, metadata value, event attribution, TLS
server identity, network location, or trace context cannot replace the
authenticated direct source.

Auditd stores both the canonical source principal and the concrete
authenticated source workload subject with every newly accepted event. It
never persists the workload token.

## Idempotency and conflict

The immutable event identity is:

```text
(canonical authenticated source principal, source_event_id)
```

Source event IDs are unique within one request. The same ID used by the other
admitted source is a distinct identity.

Canonical event content is the logical tuple of every defined event field
other than `source_event_id`, with a timestamp represented by its seconds and
nanoseconds. Protobuf encoding order, unknown fields, transport metadata,
workload token, Auditd acceptance time, and partition cursor are not event
content.

For an identity not already stored, Auditd durably inserts that exact canonical
content. An identical replay returns the original acceptance and does not
write, advance a cursor, or change acceptance time. Reusing the identity with
any different canonical field is `ALREADY_EXISTS`; the stored event remains
unchanged.

A content conflict in any event rejects the complete batch. No novel event or
cursor from that call is committed.

## Partition cursors and batch atomicity

Every event belongs to the Tenant partition named by `tenant_id`. Auditd owns
one durable cursor head per Tenant. Cursor zero is never assigned. A newly
accepted event receives the previous head plus one, up to
9,223,372,036,854,775,807.

Within one batch, novel events for the same Tenant receive cursors in request
order. Replays keep their original cursor and do not participate in
allocation. Concurrent batches have no ordering promise beyond the order in
which their persistence transactions allocate cursors. Cursors describe
Auditd acceptance order, not occurrence time, source order, causality, or
authorization.

Validation, conflict detection, novel event insertion, cursor-head updates,
and acceptance creation are one all-or-nothing persistence transaction across
the complete batch, including batches containing multiple Tenants. A failed or
rolled-back call allocates no cursor and creates no gap. Each
`partition_cursor` in the response belongs to the corresponding request
event's `tenant_id`.

A cursor is immutable acceptance metadata. It is not a continuation token,
credential, source sequence, replay position, or implied read surface.

## Persistence and runtime

Auditd owns one durable logical database. Its logical state contains:

- immutable typed event columns, their canonical source principal, and the
  concrete authenticated source workload subject;
- immutable Auditd acceptance time and positive partition cursor;
- uniqueness of `(source principal, source event ID)` and
  `(Tenant ID, partition cursor)`; and
- one positive cursor head for each non-empty Tenant partition.

Accepted evidence, acceptance time, and cursor are permanently retained and
cannot be updated, redacted, reassigned, or deleted. Restart preserves
idempotency, content-conflict detection, cursor heads, and every acceptance.
Auditd returns success only after the event and cursor transaction has durably
committed.

The Knex migration sequence is the sole schema authority. Migrations contain
only structural types, bounds, requiredness, keys, uniqueness, indexes, and
representation checks. Domain code performs event admission,
canonical-content comparison, and cursor allocation; database triggers,
stored procedures, generated side effects, generic serialized event blobs,
and a second persistence path are forbidden.

The shipping process uses a real file-backed database and a durable provider
commit mode. It does not create, infer, repair, or migrate schema at startup.
Readiness requires the exact migration ledger, compatible mapped schema,
available durable storage, valid source-authentication configuration, and
required local trust material.

Auditd has no kernel RPC dependency. Telemetry export is asynchronous and
cannot participate in acceptance.

## Delivery boundary

Tenantd and Identityd construct typed evidence after committing their owning
mutation, release every source database transaction, and call
`RecordAuditBatch` directly. They retain no audit table, outbox, queue,
journal, cursor, source sequence, delivery worker, or fallback copy. Audit
failure is `UNAVAILABLE` to their caller and does not roll back their already
committed source state.

These constraints do not create a distributed commit. Auditd durability begins
at its own successful transaction. A source process loss, exhausted deadline,
cancellation, or Auditd failure after the source mutation commits and before
Auditd accepts its event can therefore leave a committed source mutation
without accepted evidence. The one-RPC contract does not claim gap-free
correspondence across that boundary and must not hide the gap with an
unapproved delivery mechanism.

## Validation, errors, and cancellation

For a request admitted by the transport size limit, Auditd:

1. authenticates and maps the direct source;
2. requires one to 100 events and unique source event IDs;
3. requires each event's detail, operation, and attribution combination to be
   admitted for that source;
4. validates every common field, typed field, enum, and cross-field invariant;
5. checks all stored identities for identical replay or content conflict;
6. atomically persists every novel event and cursor; and
7. returns one ordered acceptance for every event.

The exact application statuses are:

| gRPC status | Meaning and effect |
| --- | --- |
| `INVALID_ARGUMENT` | The batch is empty, repeats a source event ID internally, or contains a missing, malformed, unknown-enum, inconsistent, or out-of-bound field; nothing is committed |
| `ALREADY_EXISTS` | A stored source event identity owns different canonical content; nothing new is committed |
| `RESOURCE_EXHAUSTED` | The request exceeds 100 events or 256 KiB, or a required Tenant cursor cannot advance inside its positive bound; nothing is committed |
| `UNAUTHENTICATED` | The required direct workload identity is absent or invalid; the body grants no authority |
| `PERMISSION_DENIED` | The authenticated workload is not one of the two admitted sources, or that source is not admitted for an event's detail, operation, or attribution combination; nothing is committed |
| `UNAVAILABLE` | Required persistence, schema, local trust, or authentication-key state is unavailable or incompatible before commit |
| `CANCELLED` | Caller cancellation wins before durable commit |
| `DEADLINE_EXCEEDED` | The call deadline wins before durable commit |

The transport may reject an encoded request over 256 KiB before application
authentication. Otherwise direct-source authentication precedes body
validation. Auditd returns no partial response and exposes no storage, token,
Kubernetes, stack, or raw validation diagnostic.

Cancellation is checked before persistence and propagated through every
waitable operation. Cancellation or deadline before commit rolls back the
complete transaction. Once the transaction commits, evidence and cursors
remain accepted even if cancellation, deadline, connection loss, or process
loss prevents the response from reaching the caller. An identical retry then
returns the stored acceptances.

## Telemetry

`RecordAuditBatch` extracts W3C trace context and emits standard gRPC server and
database spans, one bounded operation metric set, and correlated structured
logs. Telemetry uses:

- `service.name = auditd`;
- the generated gRPC service and method names;
- canonical `ctlflow.outcome` status names;
- bounded source kind, detail kind, batch-size, accepted-count, replay-count,
  and persistence-latency measurements; and
- bounded health, readiness, saturation, authentication-failure,
  conflict, cancellation, and telemetry-export-failure classifications.

Metric dimensions never contain a Tenant, source event, Workspace, Session,
principal, workload, operator, trace, span, cursor, or other unbounded ID.
Logs and span attributes never contain an event body, attribution value,
credential, token, authorization metadata, arbitrary protobuf content, or raw
database value. Audit evidence is never emitted as a telemetry log.

OTLP export uses finite memory, batches, timeouts, and retry budgets. Collector
failure may drop operational telemetry but cannot reject, delay, roll back, or
satisfy an audit acceptance and does not fail readiness.

## Canonical and release evidence

The checked descriptor and API manifest inventory exactly one unary method:

```text
ctlflow.audit.v1.AuditService/RecordAuditBatch
```

Descriptor verification rejects every additional method, client or server
stream, unowned message field, enum value, HTTP binding, or generic payload.
Generated bindings are deterministic drift-checked output.

The Auditd evidence manifest maps the one RPC and every documented result to
ordinary canonical integration tests. The unchanged suite runs against every
shipping implementation and proves:

- exact Tenantd and Identityd workload authentication and the complete
  source/detail/attribution admission matrix;
- every common bound, typed enum, cross-field invariant, batch bound, duplicate
  identity, and redacted error status;
- all-or-nothing mixed novel/replay/conflict batches and response order;
- identical replay, conflict on every canonical field, and independent
  same-ID use by the two sources;
- per-Tenant cursor isolation, request-order allocation, concurrent
  allocation, rollback without gaps, overflow, and stable replay cursors;
- durable restart behavior, acceptance after response loss, and conflict and
  cursor continuity through process restart;
- cancellation and deadline before commit and races after commit;
- incompatible schema, unavailable storage, health, readiness, and graceful
  shutdown; and
- trace continuity, bounded metrics, content redaction, and continued
  acceptance during Collector outage and backpressure.

Release verification also checks the Knex migration and schema manifests, the
real file-backed provider, the evidence manifest, generated-artifact drift,
shipping container and Kubernetes assets, probe-only HTTP surface, compiler
and native-publication gates required by the implementation, and the complete
Hugo specification build. No stub or test-control surface is Auditd release
evidence.
