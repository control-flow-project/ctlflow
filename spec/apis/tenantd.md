---
title: tenantd API
description: Tenant and Workspace gRPC operations, messages, pagination, and examples.
weight: 10
---

`tenantd` owns Tenant and Workspace records. Its checked contract is
[`ctlflow.tenancy.v1.TenantService`](https://github.com/control-flow-project/ctlflow/blob/main/services/tenantd/api/proto/v1/tenantd.proto).
All 12 methods are unary gRPC. See the [tenantd service specification](../../tenantd/)
for invariants, authorization, and audit behavior.

## Service definition

```proto
service TenantService {
  rpc CreateTenant(CreateTenantRequest) returns (Tenant);
  rpc GetTenant(GetTenantRequest) returns (Tenant);
  rpc ListTenants(ListTenantsRequest) returns (ListTenantsResponse);
  rpc UpdateTenant(UpdateTenantRequest) returns (Tenant);
  rpc SetTenantState(SetTenantStateRequest) returns (Tenant);

  rpc CreateWorkspace(CreateWorkspaceRequest) returns (Workspace);
  rpc GetWorkspace(GetWorkspaceRequest) returns (Workspace);
  rpc ListWorkspaces(ListWorkspacesRequest) returns (ListWorkspacesResponse);
  rpc UpdateWorkspace(UpdateWorkspaceRequest) returns (Workspace);
  rpc SetWorkspaceState(SetWorkspaceStateRequest) returns (Workspace);

  rpc ResolveTenant(ResolveTenantRequest) returns (ResolveTenantResponse);
  rpc ResolveWorkspace(ResolveWorkspaceRequest)
      returns (ResolveWorkspaceResponse);
}
```

## Tenant operations

| Method | Request fields | Returns | Purpose |
| --- | --- | --- | --- |
| `CreateTenant` | `tenant_id`, `address`, `display_name` | `Tenant` | Creates one active Tenant. The same complete declaration is retryable. |
| `GetTenant` | `tenant_id` | `Tenant` | Reads a retained Tenant in any state. |
| `ListTenants` | `page_size`, optional `after_tenant_id` | `tenants`, optional `next_after_tenant_id` | Reads one ID-ordered page. |
| `UpdateTenant` | `tenant_id`, `expected_revision`, `display_name` | `Tenant` | Changes only the display name. |
| `SetTenantState` | `tenant_id`, `expected_revision`, `state` | `Tenant` | Suspends, resumes, or terminally deletes a Tenant. |
| `ResolveTenant` | `address` | `tenant_id`, `state`, `revision` | Resolves an active external Tenant address. |

`Tenant` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `tenant_id` | string | Immutable Tenant identifier |
| `address` | string | Immutable external address |
| `display_name` | string | Mutable human-facing name |
| `state` | `ResourceState` | `ACTIVE`, `SUSPENDED`, or `DELETED` |
| `revision` | uint64 | Positive optimistic-concurrency revision |
| `created_at`, `updated_at` | timestamp | Service-owned record times |

### Create a Tenant

Request:

```json
{
  "tenantId": "northwind",
  "address": "northwind",
  "displayName": "Northwind Legal"
}
```

Response:

```json
{
  "tenantId": "northwind",
  "address": "northwind",
  "displayName": "Northwind Legal",
  "state": "RESOURCE_STATE_ACTIVE",
  "revision": "1",
  "createdAt": "2026-07-29T08:30:00Z",
  "updatedAt": "2026-07-29T08:30:00Z"
}
```

The operator equivalent is:

```text
ctlflow create tenant -f northwind.yaml
```

The file contains `tenant_id`, `address`, and `display_name`. Creating a
Tenant does not create a Workspace, User, Placement, Package, App, or
configuration record.

### Update with a revision

```json
{
  "tenantId": "northwind",
  "expectedRevision": "1",
  "displayName": "Northwind & Co."
}
```

If another accepted mutation already advanced the record, the call returns
`ABORTED`. The caller reads the current record and decides whether to submit a
new mutation against the new revision.

## Workspace operations

| Method | Request fields | Returns | Purpose |
| --- | --- | --- | --- |
| `CreateWorkspace` | `workspace_id`, `tenant_id`, `address`, `display_name` | `Workspace` | Creates one active Workspace under an active Tenant. |
| `GetWorkspace` | `workspace_id` | `Workspace` | Reads a retained Workspace in any state. |
| `ListWorkspaces` | `tenant_id`, `page_size`, optional `after_workspace_id` | `workspaces`, optional `next_after_workspace_id` | Reads one ID-ordered page within a Tenant. |
| `UpdateWorkspace` | `workspace_id`, `expected_revision`, `display_name` | `Workspace` | Changes only the display name. |
| `SetWorkspaceState` | `workspace_id`, `expected_revision`, `state` | `Workspace` | Suspends, resumes, or terminally deletes a Workspace. |
| `ResolveWorkspace` | `tenant_id`, `address` | `workspace_id`, `state`, `revision` | Resolves an active Workspace address under an active parent Tenant. |

`Workspace` contains:

| Field | Type | Meaning |
| --- | --- | --- |
| `workspace_id` | string | Immutable Workspace identifier |
| `tenant_id` | string | Immutable parent Tenant identifier |
| `address` | string | Immutable address within the parent Tenant |
| `display_name` | string | Mutable human-facing name |
| `state` | `ResourceState` | `ACTIVE`, `SUSPENDED`, or `DELETED` |
| `revision` | uint64 | Positive optimistic-concurrency revision |
| `created_at`, `updated_at` | timestamp | Service-owned record times |

### Create and resolve a Workspace

Create request:

```json
{
  "workspaceId": "atlas",
  "tenantId": "northwind",
  "address": "atlas",
  "displayName": "Project Atlas"
}
```

Later, an admitted router resolves the address without receiving the full
management record:

```json
{
  "tenantId": "northwind",
  "address": "atlas"
}
```

```json
{
  "workspaceId": "atlas",
  "state": "RESOURCE_STATE_ACTIVE",
  "revision": "1"
}
```

Suspended or deleted records remain available through `GetWorkspace`, but do
not resolve. A Workspace under a suspended or deleted Tenant also does not
resolve.

## Pagination

Tenant and Workspace lists use immutable-ID keyset pagination. A zero page
size selects 50; admitted page sizes are 1 through 100.

First Workspace page:

```json
{
  "tenantId": "northwind",
  "pageSize": 2
}
```

Response:

```json
{
  "workspaces": [
    { "workspaceId": "atlas", "tenantId": "northwind" },
    { "workspaceId": "cirrus", "tenantId": "northwind" }
  ],
  "nextAfterWorkspaceId": "cirrus"
}
```

Next request:

```json
{
  "tenantId": "northwind",
  "pageSize": 2,
  "afterWorkspaceId": "cirrus"
}
```

The continuation is the last emitted immutable ID. Tenantd stores no cursor
row and promises no snapshot across concurrent mutations.

## Outcomes

| Status | Tenantd meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid ID, address, display name, state, revision, or page size |
| `NOT_FOUND` | Exact visible record or active address is absent |
| `ALREADY_EXISTS` | Immutable ID or address belongs to a different declaration |
| `FAILED_PRECONDITION` | Current or parent state forbids the transition |
| `ABORTED` | `expected_revision` is stale |
| `UNAUTHENTICATED` | Required operator, workload, or invocation identity is invalid |
| `PERMISSION_DENIED` | Caller admission or capability check failed |
| `UNAVAILABLE` | Persistence, Identityd, Policyd, or required Auditd delivery is unavailable |
| `CANCELLED`, `DEADLINE_EXCEEDED` | The unary call did not complete |

Reads and exact no-op retries do not create audit events. Every actual
mutation commits first, then calls `auditd.RecordAuditBatch` before returning
success.
