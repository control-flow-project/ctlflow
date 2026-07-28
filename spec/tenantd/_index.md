---
title: tenantd
weight: 40
---

`tenantd` is the sole authority for Tenant and Workspace records. It exposes
only the gRPC contract in
`services/tenantd/api/proto/v1/tenantd.proto`.

## Ownership

`tenantd` owns:

- Tenants;
- Workspaces;
- each record's immutable address;
- each record's state and revision; and
- permanent retention of deleted records and their addresses.

It does not own Users, Memberships, configuration, Placements, Packages,
applications, Jobs, Runs, or their provisioning. Their owning services manage
them through separate operations.

## Records

A Tenant contains:

```text
tenant ID
address
display name
state
revision
created time
updated time
```

A Workspace contains the same fields plus one immutable parent Tenant ID.

IDs are caller-generated opaque identifiers. Tenant addresses are unique
across the installation. Workspace addresses are unique within their parent
Tenant. An address and parent cannot be changed.

Canonical field bounds are:

| Field | Admitted value |
| --- | --- |
| Tenant or Workspace ID | One to 64 lower-case ASCII characters; starts alphanumeric; remainder alphanumeric, `_`, or `-` |
| Tenant or Workspace address | One to 63 lower-case unreserved path-segment characters; cannot be `.` or `..` |
| Display name | One to 200 characters and not whitespace-only |

The canonical v1 external path is:

```text
/tenants/<tenant-address>
/tenants/<tenant-address>/workspaces/<workspace-address>
```

The external authority belongs to infrastructure configuration rather than a
Tenant or Workspace record.

## State

The complete state set is:

```text
active
suspended
deleted
```

Create produces an active record. Active and suspended records may move
between those states. Either may move to deleted. Deleted is terminal.
Deleted records cannot be updated.

A Workspace may be created or returned to active only while its parent Tenant
is active. A Tenant may be deleted only after all its Workspaces are deleted.
Suspending a Tenant does not rewrite Workspace records, but an inactive parent
makes every Workspace unavailable to resolution.

Parent checks and child mutations are committed atomically. Concurrent Tenant
deletion cannot race Workspace creation or reactivation into leaving a
non-deleted Workspace under a deleted Tenant.

Every actual mutation increments the record's positive revision. Update and
state-change requests carry the expected revision. A mismatch is aborted.
Submitting an already-satisfied display name or state returns the current
record without another mutation or audit event.

Create is naturally retryable. The same ID and declaration returns the
existing record. Reusing an ID or address for a different declaration is
already exists.

## API

The service has exactly these operations:

| Operation | Input | Result |
| --- | --- | --- |
| `CreateTenant` | Tenant ID, address, display name | Tenant |
| `GetTenant` | Tenant ID | Tenant |
| `ListTenants` | Page size, optional last Tenant ID | Bounded Tenant page |
| `UpdateTenant` | Tenant ID, expected revision, display name | Tenant |
| `SetTenantState` | Tenant ID, expected revision, desired state | Tenant |
| `CreateWorkspace` | Workspace ID, Tenant ID, address, display name | Workspace |
| `GetWorkspace` | Workspace ID | Workspace |
| `ListWorkspaces` | Tenant ID, page size, optional last Workspace ID | Bounded Workspace page |
| `UpdateWorkspace` | Workspace ID, expected revision, display name | Workspace |
| `SetWorkspaceState` | Workspace ID, expected revision, desired state | Workspace |
| `ResolveTenant` | Tenant address | Tenant ID, state, revision |
| `ResolveWorkspace` | Tenant ID, Workspace address | Workspace ID, state, revision |

No other tenantd domain operation exists.

Get and list operations return retained records in every state. Resolution
returns only active records. Workspace resolution also requires an active
parent Tenant. An absent, deleted, suspended, or cross-parent target is not
found.

Creating a Workspace under an unknown Tenant and listing Workspaces for an
unknown Tenant are `NOT_FOUND`. Creating or returning a Workspace to active
under an existing inactive Tenant is `FAILED_PRECONDITION`.

## Pagination

Lists use keyset pagination over immutable IDs:

```text
tenant_id > after_tenant_id
workspace_id > after_workspace_id
```

Results use ascending ordinal ID order. A zero page size selects the default
of 50; admitted sizes are one through 100. The service reads one extra row to
determine whether another page exists and returns the final emitted ID as the
next `after` value.

The `after` value is untrusted input, not stored server state. Each page
repeats authentication, authorization, parent fencing, validation, and
ordering. Pagination has no cursor table, snapshot journal, continuation
expiry, or mutation invalidation.

## Errors

| gRPC status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A field, page size, ID, address, state, or revision is invalid |
| `NOT_FOUND` | The exact visible record or resolvable active address does not exist |
| `ALREADY_EXISTS` | An immutable ID or address belongs to another declaration |
| `FAILED_PRECONDITION` | The current or parent state forbids the requested transition |
| `ABORTED` | The expected revision does not match |
| `UNAUTHENTICATED` | Required operator, workload, or invocation identity cannot be established |
| `PERMISSION_DENIED` | The caller is not admitted or the required capability is denied |
| `UNAVAILABLE` | Required persistence or an obligatory integration is unavailable |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The call ended before completion |

Malformed or unauthorized requests do not mutate state or emit successful
audit evidence.

## Integrations

tenantd has three disjoint admission paths:

1. An infrastructure operator presents the exact admitted certificate-backed
   subject from the current kubeconfig context. An admitted operator may call
   every operation and does not require a Tenant capability.
2. An autonomous kernel caller presents its pod-bound workload token. Its exact
   ServiceAccount subject must appear in the per-operation allowlist for
   `GetTenant`, `GetWorkspace`, `ResolveTenant`, or `ResolveWorkspace`.
3. An admitted product backend presents its pod-bound workload token and a
   required invocation JWT. Its exact ServiceAccount subject must appear in
   tenantd's capability-caller allowlist for that operation, and
   `policyd.CheckAccess` must return allow.

Autonomous-kernel and capability-caller allowlists are finite, operation
specific, and disjoint. Startup fails when a subject overlaps them. Caller
identity cannot be supplied or replaced by a request field or
caller-asserted metadata.

The operator certificate must chain to the installation's Kubernetes client
CA and contain exactly one common name. That common name has one to 253
characters and contains no Unicode whitespace or control character, so it is
admissible as typed Auditd attribution. A missing or untrusted certificate is
`UNAUTHENTICATED`; a trusted subject absent from tenantd's finite operator
allowlist is `PERMISSION_DENIED`. Workload calls never obtain operator
authority from a bearer token.

When a workload call carries an invocation JWT, tenantd obtains the active and
retiring public keys through
`identityd.GetInvocationVerificationKeys`. It caches the bounded response only
until identityd's expiry and refreshes on expiry or an unknown key ID. A known
key in a current cache remains usable during an identityd outage. A failed,
expired, or malformed key response is `UNAVAILABLE`; a successful refresh
without the requested key and invalid token claims or signatures are
`UNAUTHENTICATED`.

An invocation Tenant or Workspace fence applies before any capability
decision. A target outside that fence is `NOT_FOUND`. For an operation that
names only a Workspace ID, tenantd reads the retained Workspace to derive its
immutable parent before applying the fence; it holds no transaction while
calling a dependency. `CreateWorkspace` and `ListWorkspaces` target the
Tenant's Workspace collection and therefore require a Tenant-scoped invocation
rather than a narrower Workspace invocation. A Workspace-scoped invocation
also cannot target the parent Tenant. An autonomous admitted workload without
an invocation JWT remains bounded by its exact per-operation allowlist.

The tenant capability catalog is:

| tenantd operation | Required capability | Canonical resource path |
| --- | --- | --- |
| `GetTenant` | `tenants.read` | `/tenants/<tenant_id>` |
| `UpdateTenant` | `tenants.update_display_name` | `/tenants/<tenant_id>` |
| `CreateWorkspace` | `workspaces.create` | `/tenants/<tenant_id>/workspaces` |
| `GetWorkspace` | `workspaces.read` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |
| `ListWorkspaces` | `workspaces.read` | `/tenants/<tenant_id>/workspaces` |
| `UpdateWorkspace` | `workspaces.update_display_name` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |
| `SetWorkspaceState` to `suspended` | `workspaces.suspend` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |
| `SetWorkspaceState` to `active` | `workspaces.resume` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |
| `SetWorkspaceState` to `deleted` | `workspaces.delete` | `/tenants/<tenant_id>/workspaces/<workspace_id>` |

`CreateTenant`, `ListTenants`, and `SetTenantState` remain operator-only.
`ResolveTenant` and `ResolveWorkspace` have no capability path. `UpdateTenant`
changes only the display name; Tenant ID, address, and state are not mutable
through it.

For a capability path, tenantd constructs the operation and resource path from
validated domain values, calls `policyd.CheckAccess` as
`SERVICE/svc_tenantd`, and forwards the unchanged invocation JWT. `policyd`
independently validates that token and obtains current principal, attached
account, Membership, and direct-Group facts from `identityd`. A deny response
is `PERMISSION_DENIED`; missing current target standing is `NOT_FOUND`; a
policy or identity dependency failure is `UNAVAILABLE`. tenantd never accepts
a Role, capability, operation token, Actor, or resource path from its caller.

Every actual mutation produces one typed audit intent in Domain containing a
canonical `evt_<32 lower-hex>` source event ID, typed operation, infrastructure operator or
invocation Actor, immediate workload when present, Tenant partition, target
ID, resulting state and revision, occurrence time, and trace identity. Db
persists only Tenant or Workspace state. After Db completes and no transaction
is held, Service calls
`auditd.RecordAuditBatch` directly before returning the result. Reads,
rejected requests, retries, and no-op mutations produce no tenantd audit
event. This tenantd-specific obligation is the complete audit set for the
twelve operations. tenantd has no local audit table, outbox, worker, retry
journal, source sequence, or audit API.

Tenant and Workspace behavior is implemented only in tenantd Domain code.
Migrations contain structural tables, keys, foreign keys, uniqueness, bounds,
indexes, and representation checks. No trigger, stored procedure, database
function, or other SQL-resident behavior implements immutability, state,
revision, parent, deletion, pagination, or audit rules.

Every operation emits bounded OpenTelemetry traces, metrics, and structured
logs. Telemetry excludes addresses, display names, credentials, and request
bodies. Telemetry failure is bounded and does not become domain state.

The shipping process exposes standard health and readiness endpoints on a
separate probe-only listener. The gRPC listener uses
installation-provisioned server TLS and optional Kubernetes
client-certificate authentication for operators. Readiness verifies the
current schema and required local custody. These operational endpoints are
not tenantd domain operations.

## Verification

Canonical integration evidence covers:

- every RPC and every documented status;
- create retry, immutable identity and address ownership;
- update and state revision conflicts;
- every valid and invalid state transition;
- parent fencing, Tenant deletion with remaining Workspaces, and concurrent
  parent-child mutation safety;
- retained deleted records and permanent address reservation;
- bounded last-ID pagination under concurrent changes;
- active-only Tenant and Workspace resolution;
- operator, autonomous-kernel, and product-backend admission;
- every capability token and canonical resource path;
- independent tenantd and policyd invocation validation;
- current identity and direct-Group facts, allow, deny, missing standing,
  disabled identity, and dependency outage;
- cancellation, deadline, restart, and schema failure;
- one audit event per actual mutation and none for reads or no-op retries; and
- bounded, correlated, redacted telemetry.

There is no HTTP administrative API, Kubernetes aggregated API, watch,
streaming RPC, resource-event history, lifecycle coordinator, provisioning
workflow, binding generation, or stored pagination cursor in `tenantd`.
