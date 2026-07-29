---
title: auditd API
description: Typed, immutable kernel mutation evidence over gRPC.
weight: 70
---

`auditd` is the authority for immutable kernel audit evidence. Its checked
contract is
[`ctlflow.audit.v1.AuditService`](https://github.com/control-flow-project/ctlflow/blob/main/services/auditd/api/proto/v1/auditd.proto).
It has one unary gRPC method. See the
[auditd service specification](../../auditd/) for source admission,
partitioning, replay, and retention rules.

## Service definition

```proto
service AuditService {
  rpc RecordAuditBatch(RecordAuditBatchRequest)
      returns (RecordAuditBatchResponse);
}
```

## RecordAuditBatch

The request contains 1 through 100 typed `AuditEvent` values and is at most
256 KiB encoded. The response contains one `AuditAcceptance` per request event
in request order.

```proto
message RecordAuditBatchRequest {
  repeated AuditEvent events = 1;
}

message RecordAuditBatchResponse {
  repeated AuditAcceptance acceptances = 1;
}

message AuditAcceptance {
  string source_event_id = 1;
  uint64 partition_cursor = 2;
}
```

There is no query, list, search, export, delete, redact, repair, watch, stream,
queue, cursor-management, or administration API.

## Event envelope

Every event contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `source_event_id` | string | `evt_` plus 32 lower-case hexadecimal characters |
| `occurred_at` | timestamp | Time at which the source accepted the mutation |
| `attribution` | oneof | Operator, workload, or invocation attribution |
| `partition` | oneof | Global or exact Tenant partition |
| `trace_id` | string | Non-zero 32-character W3C trace ID |
| `span_id` | string | Non-zero 16-character W3C span ID |
| `detail` | oneof | Exactly one approved typed mutation detail |

Attribution is one of:

```text
operator common name
authenticated workload subject
invocation Actor + attached account + immediate workload subject
```

An `agent:` Actor remains distinct from its attached `user:` or `service:`
account. Both identities are retained.

## Typed detail inventory

| Detail | Mutation evidence |
| --- | --- |
| `tenant_mutation` | Tenant action, revision, resulting state |
| `workspace_mutation` | Workspace ID, action, revision, resulting state |
| `identity_session` | Session ID, human account, revision, created or revoked |
| `package_declaration` | Package ID and generation |
| `app_mutation` | App scope, Placement, Package generation, revision, action |
| `configuration_publication` | Exact version, binding, identity revision, optional claim pair |
| `secret_publication` | Exact version, binding, identity revision, optional claim pair |
| `projection_mutation` | Projection, exact target, binding, revision, action |
| `placement_mutation` | Placement target, desired state, revision, action |
| `workload_mutation` | Workload target and admitted App/Package component snapshot |
| `run_mutation` | Run target, revision, optional Actor, create or cancellation request |

The contract has no generic operation string, JSON payload, property bag, or
opaque detail bytes. Credentials, content, provider options, Kubernetes
coordinates, invocation JWTs, secrets, and signing material are not audit
detail.

## Tenant mutation example

After Tenantd commits a new Tenant, it releases its database transaction and
calls Auditd:

```json
{
  "events": [
    {
      "sourceEventId": "evt_0123456789abcdef0123456789abcdef",
      "occurredAt": "2026-07-29T08:30:00Z",
      "attribution": {
        "operatorCommonName": "operator@example.com"
      },
      "partition": {
        "tenant": {
          "tenantId": "northwind"
        }
      },
      "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
      "spanId": "00f067aa0ba902b7",
      "tenantMutation": {
        "action": "TENANT_MUTATION_ACTION_CREATE_TENANT",
        "resourceRevision": "1",
        "resultingState": "TENANCY_RESOURCE_STATE_ACTIVE"
      }
    }
  ]
}
```

Response:

```json
{
  "acceptances": [
    {
      "sourceEventId": "evt_0123456789abcdef0123456789abcdef",
      "partitionCursor": "1"
    }
  ]
}
```

The cursor is monotonic within the Tenant partition. It is acceptance
metadata, not a pagination token or query surface.

## Invocation-attributed example

For an agent-driven Workspace mutation, Tenantd sends both the virtual Actor
and attached account:

```json
{
  "attribution": {
    "invocation": {
      "actorPrincipalId": "agent:reviewer",
      "attachedAccountPrincipalId": "user:maya",
      "workloadSubject": "system:serviceaccount:product-atlas:workspace-api"
    }
  }
}
```

The full event still requires partition, trace identifiers, and exactly one
typed detail. Auditd authenticates Tenantd as the direct source; Tenantd
attests the upstream attribution it already validated.

## Delivery and replay

The accepted event identity is:

```text
(canonical authenticated source service, source_event_id)
```

An identical retry returns the original partition cursor without another
write. Different content at the same identity returns `ALREADY_EXISTS`. The
complete batch is atomic across all included partitions.

Source services call Auditd only after an actual mutation commits and no
source transaction remains open. A required delivery failure makes the source
RPC return `UNAVAILABLE`; the source does not create an audit outbox, local
queue, journal, or fallback record.

## Source admission

| Authenticated source | Admitted detail families |
| --- | --- |
| `SERVICE/svc_tenantd` | Tenant and Workspace mutations |
| `SERVICE/svc_identityd` | Identity Session mutations |
| `SERVICE/svc_pkgd` | Package and App mutations |
| `SERVICE/svc_configd` | Configuration, secret, and projection mutations |
| `SERVICE/svc_execd` | Placement, Workload, and Run mutations |

Auditd validates the bound Kubernetes workload bearer and the exact
source/detail/attribution combination. Request data cannot name another
source.

## Outcomes

| Status | Auditd meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Empty batch, duplicate request ID, malformed event, or inconsistent typed detail |
| `ALREADY_EXISTS` | Stored source event identity has different canonical content |
| `RESOURCE_EXHAUSTED` | Batch count, encoded size, or partition cursor limit is exceeded |
| `UNAUTHENTICATED` | Direct source workload identity is absent or invalid |
| `PERMISSION_DENIED` | Source, detail, partition, action, or attribution combination is not admitted |
| `UNAVAILABLE` | Persistence, schema, trust, or key state is unavailable |
| `CANCELLED`, `DEADLINE_EXCEEDED` | The batch did not durably commit |

Once the batch commits, a lost response does not undo acceptance. The caller
retries the same event identity and receives the original cursor.
