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
- Preserve Tenant, Workspace, Placement, Package, App, Job, Run, request, and trace references.
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

Runtime proxies and mediation services emit decision evidence with request IDs. Application
workloads cannot submit authoritative kernel events directly.

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

## Retention, deletion, and integrity

Audit Events are immutable. Retention may remove expired events according to partition policy.

When retained detail must be removed immediately, `auditd` hard-deletes the prohibited payload,
preserves its digest commitment and immutable envelope, and appends a new payload-deletion event
containing authorizer, reason, time, and target event. Sequence verification therefore proves that
content was deliberately removed without retaining the prohibited content.

An ordinary domain deletion can never erase audit evidence silently.

## Direct operations

| Operation | Purpose |
| --- | --- |
| Record / RecordBatch | Ingest idempotent authenticated evidence |
| Query / Count | Read one bounded authorized partition |
| Export | Create and inspect bounded asynchronous extraction |
| RedactPayload | Replace admitted detail with a redacted commitment |
| DeletePayload | Hard-delete admitted detail and append deletion evidence |
| Health / Ready | Report persistence and ingestion readiness |

## Invariants

- An accepted event is immutable and attributable to one authenticated source action.
- Tenant callers cannot query another Tenant partition.
- Global evidence is distinct from Tenant partitions.
- Export APIs return metadata and purpose-bound transfer access, not export bytes.
- Audit unavailability cannot silently discard committed source evidence.
- Payload removal always leaves immutable deletion evidence and the original commitment.
