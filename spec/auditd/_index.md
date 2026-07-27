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
in request order, with the exact `source_event_id` and positive
partition-local `partition_cursor`.

There is no public listener, operator RPC, invocation-identity path, read,
query, list, search, export, delete, redact, repair, watch, stream, queue,
worker, cursor-management, administration, HTTP, or Kubernetes-resource API.
The separate probe listener serves only `/healthz` and `/readyz`.

## Event envelope

| Field | Admitted value |
| --- | --- |
| `source_event_id` | Exactly `evt_` followed by 32 lower-case hexadecimal characters |
| `occurred_at` | Present valid `google.protobuf.Timestamp`; no age window |
| `attribution` | Exactly one admitted typed attribution |
| `partition` | Exactly one `GlobalAuditPartition` or `TenantAuditPartition` |
| `trace_id` | Non-zero 32-character lower-case hexadecimal W3C trace ID |
| `span_id` | Non-zero 16-character lower-case hexadecimal W3C span ID |
| `detail` | Exactly one admitted typed detail |

The Global partition is one installation-wide partition and carries no
caller-defined value. A Tenant partition carries one canonical Tenant ID.
Tenant and Workspace IDs use Tenantd's canonical one-to-64-character grammar.
Package IDs use Pkgd's canonical one-to-128-character grammar. App, Placement,
Workload, consumer, projection, configuration, secret, version, dependency
claim, and component IDs use their owner's canonical bounds. Run IDs use
Execd's canonical one-to-128-character grammar. Principal IDs use Identityd's
canonical kind and local-ID grammar and are at most 256 characters. Revisions
and generations are positive signed 64-bit values.

Unknown wire fields and transport metadata have no evidence semantics and are
not persisted. The contract has no source schema generation, free-form
operation or outcome, separate idempotency key, caller-defined partition,
source sequence, property bag, JSON, opaque bytes, or generic payload.

## Typed details

The complete detail inventory is:

| Detail | Typed content |
| --- | --- |
| `TenantMutationAuditDetail` | Tenant action, resulting revision, and resulting state |
| `WorkspaceMutationAuditDetail` | Workspace ID, Workspace action, resulting revision, and resulting state |
| `IdentitySessionAuditDetail` | Session ID, human account principal, resulting revision, and action |
| `PackageDeclarationAuditDetail` | Package ID and declared generation |
| `AppMutationAuditDetail` | Complete App scope, App/Placement/Package IDs, resulting Package generation and App revision, and action |
| `ConfigurationPublicationAuditDetail` | Configuration and version IDs, complete consumer binding, resulting identity revision, and optional dependency claim ID/revision pair |
| `SecretPublicationAuditDetail` | Secret and version IDs, complete consumer binding, resulting identity revision, and optional dependency claim ID/revision pair |
| `ProjectionMutationAuditDetail` | Projection action, ID, revision, typed configuration or secret target, and complete consumer binding |
| `PlacementMutationAuditDetail` | Placement action, ID, complete target, resulting desired state and revision |
| `WorkloadMutationAuditDetail` | Workload action, Workload/Placement IDs and target, resulting desired state and revision, and admitted App ID/revision, Package ID/generation, and component ID |
| `RunMutationAuditDetail` | Run action, Run/Workload/Placement IDs and target, resulting revision, and optional configured Run Actor |

`PlacementAuditTarget` is a closed oneof: Global; Tenant with Tenant ID;
Workspace with Tenant and Workspace IDs; or User with Tenant ID and canonical
`user:` or `service:` account principal. `ConsumerBindingAuditDetail` contains
one Placement ID and target, consumer ID, and Configd purpose token.

The finite action and state sets are:

- Tenant: `CREATE_TENANT`, `UPDATE_TENANT`, `SET_TENANT_STATE`;
- Workspace: `CREATE_WORKSPACE`, `UPDATE_WORKSPACE`,
  `SET_WORKSPACE_STATE`;
- Identity Session: `CREATED`, `REVOKED`;
- App: `CREATED`, `PACKAGE_GENERATION_CHANGED`;
- Projection: `CREATED`, `VERSION_CHANGED`;
- Placement: `DECLARED`, `UPDATED`;
- Workload: `DECLARED`, `UPDATED`;
- Run: `CREATED`, `CANCELLATION_REQUESTED`;
- Tenant and Workspace state: `ACTIVE`, `SUSPENDED`, `DELETED`; and
- Placement and Workload desired state: `ACTIVE`, `SUSPENDED`, `RETIRED`.

Create Tenant and Workspace evidence requires revision 1 and `ACTIVE`. Their
updates require revision at least 2 and an owner-admitted resulting state.
Session `CREATED` requires revision 1; `REVOKED` requires revision 2.
Package generation is positive. App `CREATED` requires revision 1;
`PACKAGE_GENERATION_CHANGED` requires revision at least 2.

Configuration and secret publication identify exactly one data class.
Dependency claim ID and positive revision are both present exactly for
provisioner workload attribution and both absent for operator or invocation
attribution. An unpaired or non-positive claim value is `INVALID_ARGUMENT`; a
well-formed pair or absence inconsistent with the authenticated source and
attribution is `PERMISSION_DENIED`.
Projection `CREATED` requires revision 1; `VERSION_CHANGED` requires revision
at least 2. Placement and Workload `DECLARED` require revision 1 and `UPDATED`
requires revision at least 2. Run `CREATED` requires revision 1; first
cancellation carries the resulting positive revision.

Package declarations use Global. Every other detail uses Global exactly when
its complete App scope, consumer binding, or Placement target is Global;
otherwise it uses the Tenant partition whose Tenant ID equals that target.
Tenant, Workspace, and Identity Session details always use their exact Tenant
partition. A detail cannot name or imply another Tenant.

Only successful actual mutations are admitted. Reads, lists, rejected calls,
idempotent create retries, no-op declarations or updates, repeated Session
revocation, repeated Run cancellation, realization observations, repair, and
later Run phase changes emit no event. Credentials, content, digests, provider
options, native coordinates, invocation JWTs, signing or encryption material,
headers, and secrets are not admitted evidence.

## Attribution and source admission

Attribution is exactly:

- an authenticated operator certificate common name;
- an immediate Kubernetes ServiceAccount workload subject; or
- an invocation Actor, its attached `user:` or `service:` account, and the
  immediate Kubernetes ServiceAccount workload subject.

An operator common name has one to 253 characters and contains no Unicode
whitespace or control character. A workload subject is exactly
`system:serviceaccount:<namespace>:<service-account>`, with canonical
one-to-63-character Kubernetes DNS-label names. A direct `user:` or `service:`
Actor equals its attached account. An `agent:` Actor is distinct from its
attached account. Nested or unrelated Actor chains are invalid.

`RecordAuditBatch` authenticates exactly one `authorization` value with the
case-sensitive `Bearer ` scheme and a one-to-16,384-character workload JWT.
Auditd validates issuer, signature, installation audience, expiry, maximum
lifetime, binding, namespace, and exact ServiceAccount subject, then maps that
subject to one canonical source principal.

| Authenticated source | Admitted detail | Admitted attribution |
| --- | --- | --- |
| `SERVICE/svc_tenantd` | Tenant mutation | Operator; invocation only for `UPDATE_TENANT` |
| `SERVICE/svc_tenantd` | Workspace mutation | Operator or invocation |
| `SERVICE/svc_identityd` | Identity Session mutation | Workload |
| `SERVICE/svc_pkgd` | Package declaration | Operator |
| `SERVICE/svc_pkgd` | App mutation | Operator or invocation |
| `SERVICE/svc_configd` | Configuration or secret publication | Operator, invocation, or workload |
| `SERVICE/svc_configd` | Projection mutation | Workload |
| `SERVICE/svc_execd` | Placement, Workload, or Run mutation | Operator or invocation |

Global App and Execd evidence is operator-attributed. Global Configd
publication is operator-attributed. Provisioner-attributed Configd publication
is non-Global and carries its dependency claim ID and positive observed
revision. Tenantd, Identityd, Pkgd, Configd, and Execd attest only attribution
they already authenticated and validated under their owner contracts.

Configuration maps one distinct canonical ServiceAccount subject to each of
the five sources. No request field, attribution value, invocation JWT, TLS
server identity, network location, or trace context can replace the
authenticated direct source. Auditd stores the canonical source and concrete
authenticated source subject with each newly accepted event, never the token.

## Acceptance

Event identity is:

```text
(canonical authenticated source principal, source_event_id)
```

Canonical content is every other defined event field, with timestamps
compared as seconds and nanoseconds. An identical replay returns the original
acceptance without writing or advancing a cursor. Different canonical content
for the same identity is `ALREADY_EXISTS`. Event IDs must be unique within a
request, and any conflict rejects the complete batch without committing novel
events or cursors.

Each partition has one cursor sequence: one for Global and one for every
non-empty Tenant. New events receive consecutive positive signed-64-bit
cursors in request order within their partition. Replays keep their original
cursors. Concurrent requests are ordered only by transactional cursor
allocation.

Validation, conflict detection, insertion, cursor allocation, and acceptance
are one transaction for the complete batch, including multiple partitions.
Rollback allocates no cursor and creates no gap. A cursor is acceptance
metadata, not a continuation, replay, authorization, or source-sequence API.

The five admitted sources call directly after committing their mutation and
releasing the source transaction as defined in [Contracts](../contracts/). A
committed mutation returns `UNAVAILABLE` when required delivery fails;
identical delivery retry is idempotent. Sources retain no audit table, outbox,
queue, journal, cursor, worker, repair path, or fallback copy.

## Errors

| gRPC status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Empty batch, duplicate request event ID, or malformed, unknown-enum, inconsistent, or out-of-bound event |
| `ALREADY_EXISTS` | Stored event identity has different canonical content |
| `RESOURCE_EXHAUSTED` | More than 100 events, more than 256 KiB, or exhausted partition cursor |
| `UNAUTHENTICATED` | Direct source workload identity is absent or invalid |
| `PERMISSION_DENIED` | Source, detail, partition, action, or attribution combination is not admitted |
| `UNAVAILABLE` | Required persistence, schema, trust, or authentication-key state is unavailable or incompatible |
| `CANCELLED` | Caller cancellation wins before durable commit |
| `DEADLINE_EXCEEDED` | Deadline wins before durable commit |

Authentication precedes body validation unless transport rejects an oversized
request. Errors return no partial response or raw diagnostic. Cancellation or
deadline before commit rolls back the batch. Once committed, evidence remains
accepted even if the response is lost; identical retry returns its acceptance.

## Runtime and evidence

Auditd owns one durable logical database of immutable typed events, canonical
and concrete source identity, acceptance time, partition cursor, and one
cursor head per non-empty partition. `(source principal, source event ID)` and
`(partition, cursor)` are unique. Accepted evidence, acceptance time, and
cursor are permanently retained and cannot be updated, reassigned, redacted,
or deleted. Success follows durable commit; restart preserves events,
acceptances, replay comparison, and cursor heads.

Service-root Knex migrations are the sole schema authority. Storage uses typed
constrained columns, not a generic serialized event blob. Readiness requires
the exact migration ledger, compatible mapped schema, durable storage, five
valid distinct source mappings, and local trust. Auditd has no kernel RPC
dependency.

Auditd emits bounded OpenTelemetry gRPC, database, probe, and export telemetry
with canonical outcomes. Dimensions may include bounded source kind, detail
kind, partition kind, batch size, counts, and stable failure class, never
event content or unbounded identifiers. Logs contain no attribution,
credential, token, body, or raw database value. Collector failure changes
neither acceptance nor readiness.

The checked descriptor and API manifest contain exactly the unary
`ctlflow.audit.v1.AuditService/RecordAuditBatch` method and its finite typed
messages and enums. Canonical evidence covers every source/detail/attribution
combination and rejection, operator common-name lengths one and 253 and
rejection of empty, overlong, Unicode-whitespace, or control-containing names,
dependency claim ID/revision pairing and attribution, partition coherence,
bounds, atomic batches, replay and conflict, Global and Tenant cursors,
cancellation, restart, schema/readiness failure, and redacted telemetry.
Shared process, migration, packaging, and release rules are in
[Implementation](../implementation/); no stub or test-control surface is
Auditd release evidence.
