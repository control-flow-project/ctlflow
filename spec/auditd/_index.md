---
title: auditd
weight: 80
---

`auditd` is the sole authority for immutable kernel audit evidence. It accepts
only the typed successful-mutation evidence declared by its protobuf contract;
operational observations remain in [Telemetry](../telemetry/).

## Surface

`ctlflow.audit.v1.AuditService` exposes exactly one private unary RPC,
`RecordAuditBatch`. Its request contains one to 100 `AuditEvent` values and is
at most 256 KiB encoded. Its response contains one `AuditAcceptance` per event
in request order, with the exact `source_event_id` and positive Tenant-partition
`partition_cursor`.

There is no public listener, operator RPC, invocation-identity path, read,
list, search, export, delete, redact, watch, stream, queue, worker,
cursor-management, administration, HTTP, or Kubernetes-resource API. The
separate probe listener serves only `/healthz` and `/readyz`.

## Events

| Field | Admitted value |
| --- | --- |
| `source_event_id` | Exactly 32 lower-case hexadecimal characters encoding 128 source-generated random bits; not all zero |
| `occurred_at` | Present, valid `google.protobuf.Timestamp`; no age window |
| `attribution` | Exactly one admitted attribution |
| `tenant_id` | Canonical Tenant ID and the event partition |
| `trace_id` | Non-zero 32-character lower-case hexadecimal W3C trace ID |
| `span_id` | Non-zero 16-character lower-case hexadecimal W3C span ID |
| `detail` | Exactly one admitted typed detail |

Tenant and Workspace IDs use Tenantd's canonical one-to-64-character grammar.
Principal IDs use Identityd's canonical kind and local-ID grammar and are at
most 256 characters. Session IDs are exactly 32 lower-case hexadecimal
characters. Revisions are positive signed 64-bit values.

| Detail | Typed content |
| --- | --- |
| `TenantMutationAuditDetail` | `CREATE_TENANT`, `UPDATE_TENANT`, or `SET_TENANT_STATE`; resulting revision and state |
| `WorkspaceMutationAuditDetail` | Workspace ID; `CREATE_WORKSPACE`, `UPDATE_WORKSPACE`, or `SET_WORKSPACE_STATE`; resulting revision and state |
| `IdentitySessionAuditDetail` | Session ID, human `user:` account principal, resulting revision, and `CREATED` or `REVOKED` |

Create Tenant and Workspace evidence requires revision 1 and `ACTIVE`. Update
evidence requires revision at least 2 and `ACTIVE` or `SUSPENDED`. Set-state
evidence requires revision at least 2 and a defined state. Session `CREATED`
requires revision 1; `REVOKED` requires revision 2.

Only successful actual mutations are admitted. Reads, rejected calls,
idempotent create retries, no-op updates or state changes, no-op Session
revocation, Session exchange, and invocation issuance emit no event.

The contract has no caller-defined schema generation, free-form operation or
outcome, separate idempotency field, global partition, property bag, JSON,
opaque bytes, or generic payload. Credentials, digests, provider identities,
addresses, display names, bodies, invocation JWTs, signing material, headers,
and secrets are not admitted evidence.

## Attribution and admission

Attribution is exactly an authenticated operator certificate common name, a
canonical Kubernetes ServiceAccount subject, or an invocation containing the
canonical Actor, subject account, and immediate ServiceAccount subject. An
operator common name has one to 253 Unicode scalar values, no control scalar,
and is not whitespace-only. A workload subject is exactly
`system:serviceaccount:<namespace>:<service-account>`, with canonical
one-to-63-character Kubernetes DNS-label names.

For invocation attribution, a direct `user:` or `service:` Actor equals its
subject account. An `agent:` Actor is distinct from its `user:` or `service:`
subject account. Nested or unrelated Actor chains are invalid. Tenantd and
Identityd attest only identity they already authenticated and validated.

`RecordAuditBatch` authenticates exactly one `authorization` value with the
case-sensitive `Bearer ` scheme and a one-to-16,384-character workload JWT.
Auditd validates issuer, signature, installation audience, expiry, maximum
lifetime, binding, namespace, and exact ServiceAccount subject, then maps that
subject to the canonical source principal.

| Source | Detail | Attribution |
| --- | --- | --- |
| `SERVICE/svc_tenantd` | Tenant mutation | Operator; invocation only for `UPDATE_TENANT` |
| `SERVICE/svc_tenantd` | Workspace mutation | Operator or invocation |
| `SERVICE/svc_identityd` | Identity Session mutation | Workload |

Configuration maps one distinct canonical ServiceAccount subject to each
source. No request field, attribution, invocation JWT, TLS server identity,
network location, or trace context can replace the direct source. Auditd stores
the canonical source and concrete authenticated subject, never the token.

## Acceptance

Event identity is `(canonical source principal, source_event_id)`. Canonical
content is every other defined field, with timestamps compared as seconds and
nanoseconds. Unknown wire fields and transport metadata have no evidence
semantics and are not persisted.

An identical replay returns the original acceptance without writing or
advancing a cursor. Different canonical content for the same identity is
`ALREADY_EXISTS`. Event IDs must be unique within a request, and any conflict
rejects the complete batch without committing novel events or cursors.

Each Tenant has one Auditd cursor sequence. New events receive consecutive
positive signed-64-bit cursors in request order within that Tenant. Replays keep
their original cursors. Concurrent requests are ordered only by transactional
cursor allocation.

Validation, conflict detection, insertion, cursor allocation, and acceptance
are one transaction for the complete batch, including multiple Tenants.
Rollback allocates no cursor and creates no gap. A cursor is acceptance
metadata, not a continuation, replay, authorization, or source-sequence API.

Tenantd and Identityd call directly after committing their mutation and
releasing the source transaction as defined in [Contracts](../contracts/). A
committed mutation returns `UNAVAILABLE` when required delivery fails;
identical delivery retry is idempotent. Sources retain no audit table, outbox,
queue, journal, cursor, worker, or fallback copy.

## Errors

| gRPC status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Empty batch, duplicate request event ID, or malformed, unknown-enum, inconsistent, or out-of-bound event |
| `ALREADY_EXISTS` | Stored event identity has different canonical content |
| `RESOURCE_EXHAUSTED` | More than 100 events, more than 256 KiB, or exhausted Tenant cursor |
| `UNAUTHENTICATED` | Direct workload identity is absent or invalid |
| `PERMISSION_DENIED` | Workload, detail, operation, or attribution combination is not admitted |
| `UNAVAILABLE` | Required persistence, schema, trust, or authentication-key state is unavailable or incompatible |
| `CANCELLED` | Caller cancellation wins before durable commit |
| `DEADLINE_EXCEEDED` | Deadline wins before durable commit |

Authentication precedes body validation unless transport rejects an oversized
request. Errors return no partial response or raw diagnostic. Cancellation or
deadline before commit rolls back the batch. Once committed, evidence remains
accepted even if the response is lost; identical retry returns its acceptance.

## Runtime and evidence

Auditd owns one durable logical database of immutable typed events, canonical
and concrete source identity, acceptance time, Tenant cursor, and one cursor
head per non-empty Tenant. `(source principal, source event ID)` and
`(Tenant ID, cursor)` are unique. Accepted evidence, acceptance time, and cursor
are permanently retained and cannot be updated, reassigned, redacted, or
deleted. Success follows durable commit; restart preserves events,
acceptances, replay comparison, and cursor heads.

Service-root Knex migrations are the sole schema authority. Storage uses typed
constrained columns, not a generic serialized event blob. Readiness requires
the exact migration ledger, compatible mapped schema, durable storage, valid
source mappings, and local trust. Auditd has no kernel RPC dependency.

Auditd emits bounded OpenTelemetry gRPC, database, probe, and export telemetry
with canonical outcomes. Dimensions may include bounded source kind, detail
kind, batch size, counts, and stable failure class, never event content or
unbounded identifiers. Logs contain no attribution, credential, token, body,
or raw database value. Collector failure changes neither acceptance nor
readiness.

The checked descriptor and API manifest contain exactly the unary
`ctlflow.audit.v1.AuditService/RecordAuditBatch` method and its typed messages
and enums. Canonical evidence covers admission and validation, atomic batches,
replay and conflict, per-Tenant cursors, cancellation, restart,
schema/readiness failure, and redacted telemetry. Shared process, migration,
packaging, and release rules are in [Implementation](../implementation/); no
stub or test-control surface is Auditd release evidence.
