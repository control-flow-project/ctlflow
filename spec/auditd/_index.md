---
title: auditd
weight: 80
---

`auditd` is the authority for required kernel audit evidence. Audit is
domain evidence, not operational telemetry.

## Approved contract

The service-owned protobuf contract exposes exactly:

```text
RecordAuditBatch
```

The request contains one source schema generation and a bounded batch of typed
events. Each event contains:

```text
source event ID
idempotency key
operation and occurrence time
authenticated attribution
global or Tenant partition
trace and span IDs
one typed detail
```

The approved detail set contains Tenant and Workspace mutation evidence. The
response returns one acceptance per event with source event ID and partition
cursor.

No query, export, watch, stream, redaction, payload-deletion,
cursor-management, or Kubernetes-resource operation exists in the contract.
This service has no CtlFlow CRD or aggregated API.

## Delivery

The source service constructs evidence only after it knows the authoritative
outcome, then calls `RecordAuditBatch` directly without holding its database
transaction.

```text
source Domain outcome -> source service -> auditd.RecordAuditBatch
```

Source services retain no audit table, outbox, queue, journal, source sequence,
or retry worker. An obligatory audit call that cannot complete is an explicit
dependency failure. A committed source mutation is not rolled back by a later
audit failure.

## Idempotency

The pair of source identity and source event ID identifies one event.
Repeating the same canonical event is accepted idempotently. Reusing that
identity for conflicting content is rejected.

Partition cursors are auditd-owned acceptance metadata. They do not imply a
query or replay API.

## Authentication and attribution

The immediate source comes from authenticated workload transport. Event
attribution is either:

- the admitted infrastructure operator subject; or
- an Actor and attached account established by a validated invocation.

Optional immediate caller and runtime principal fields preserve the concrete
workload chain. Caller-supplied identity cannot replace authenticated source or
validated invocation facts.

## Errors

| gRPC status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Batch or event shape is malformed or unsupported |
| `ALREADY_EXISTS` | An idempotency identity conflicts with stored content |
| `RESOURCE_EXHAUSTED` | The bounded batch limit is exceeded |
| `UNAUTHENTICATED` | Source workload identity cannot be established |
| `PERMISSION_DENIED` | Source is not admitted for the detail type |
| `UNAVAILABLE` | Required audit persistence is unavailable |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The call did not complete |

## Invariants

- Accepted evidence is immutable.
- Typed detail is versioned with the protobuf contract.
- Credentials, request bodies, display names, addresses, and secret material
  are never accepted as generic payload.
- OpenTelemetry cannot satisfy an audit obligation.
- Audit persistence is private to `auditd`.

## Verification

Canonical evidence covers source authentication, one-to-one batch
acceptances, idempotent replay, conflicting replay, bounds, typed validation,
persistence restart, dependency failure, cancellation, and redacted
correlated telemetry.
