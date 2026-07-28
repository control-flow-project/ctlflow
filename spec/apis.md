---
title: APIs
weight: 20
---

Every CtlFlow operation belongs to one service and one versioned,
language-neutral contract. An operation absent from that contract does not
exist.

## Operator access

`ctlflow` selects an infrastructure through a certificate-backed kubeconfig.
For a private gRPC service, it asks the Kubernetes API for an authorized
port-forward to the service and then speaks end-to-end TLS and gRPC through
that tunnel using the selected kubeconfig client certificate.

```text
 ctlflow
    |
    | kubeconfig authentication and port-forward authorization
    v
 Kubernetes API server
    |
    | byte transport only
    v
 service gRPC listener
    ^
    | kubeconfig client certificate
    +---------------- ctlflow
```

The Kubernetes API server does not translate, implement, or persist the gRPC
resource. The service validates the client-certificate chain against the
installation's Kubernetes client CA and admits the exact certificate subject.
That subject authenticates the operator call and is retained for audit
evidence. A request body or metadata header cannot name or replace it.

This is the operator transport. There is no implied
Kubernetes aggregated API, CRD, HTTP mirror, gateway, or second administrative
contract.

## Public HTTP

`authd` is the owner reserved for browser authentication HTTP. `edged` is the
owner reserved for application and product HTTP. A route exists only when it
appears in that owner's checked versioned HTTP contract; neither ownership
boundary implies a route or alternate kernel record shape.

```text
 browser -> authd

 browser or external client -> edged -> admitted application or kernel call
```

The complete approved Authd browser contract is:

```text
POST /auth/v1/begin
GET  /auth/v1/callback
POST /auth/v1/logout
```

The checked `services/authd/api/http/v1/openapi.yaml` is authoritative for this
inventory and its wire contract. Bounds, dependencies, security, telemetry,
and evidence are defined by [authd](../authd/). Authd has no other public
method or route and no private inbound RPC.

Public cookie headers and external bearer credentials never become authentication metadata for a
private service call. A public boundary may extract an approved opaque credential and pass it only
as typed request data to the service that owns that credential, such as `ExchangeSession`.
The receiving boundary establishes a short-lived internal invocation identity when a call acts on
behalf of a User or Job.

## Private gRPC

Kernel service contracts use gRPC. Each method has one intent, typed input,
typed output, and documented statuses. Generic commands, untyped selectors,
property bags, and caller-defined response shapes are not contracts.

Every private call carries:

```text
immediate caller authentication
optional validated invocation identity
deadline and cancellation
W3C trace context
```

The receiver independently authenticates the immediate caller and fences the
target. Body fields cannot replace caller, Actor, Tenant, Workspace, or Run
facts established by transport identity.

## Approved tenantd contract

`tenantd` exposes exactly:

```text
CreateTenant
GetTenant
ListTenants
UpdateTenant
SetTenantState

CreateWorkspace
GetWorkspace
ListWorkspaces
UpdateWorkspace
SetWorkspaceState

ResolveTenant
ResolveWorkspace
```

The complete messages and behavior are defined by
[tenantd](../tenantd/) and its owned protobuf contract. It has no HTTP,
Kubernetes-resource, watch, or streaming surface.

## Approved pkgd contract

`pkgd` exposes exactly:

```text
DeclarePackage
GetPackage

CreateApp
GetApp
SetAppPackageGeneration
```

The complete messages and behavior are defined by [pkgd](../pkgd/) and its
owned protobuf contract. Infrastructure operators may call every operation.
The exact `SERVICE/svc_execd` workload may additionally call `GetPackage` and
`GetApp`. Configured product backends may additionally call `CreateApp`,
`GetApp`, and `SetAppPackageGeneration` for Tenant, Workspace, or User scope
only through the validated invocation and Policyd capability path. Global
Apps have no capability path.

Package generations are immutable, sequential, exact-ID declarations. App
scope, Placement reference, and Package identity are immutable; the desired
Package generation is its only revision-controlled transition. App scope is
closed over Global, Tenant, Workspace, and User. There is no HTTP, list,
pagination, build, artifact-transfer, lifecycle, watch, stream, provider,
routing, dependency-provisioning, identity, policy, or Kubernetes-resource
surface.

## Approved capability authorization dependencies

The capability paths used by Tenantd, Pkgd, and Configd require exactly these
`identityd` operations:

```text
GetInvocationVerificationKeys
ResolvePrincipal
ListPrincipalGroups
```

`GetInvocationVerificationKeys` returns the bounded active and retiring public
verification keys to an admitted workload without requiring the invocation
being bootstrapped. `ResolvePrincipal` returns current principal, attached
account, and exact target-standing facts. `ListPrincipalGroups` returns a
bounded page of current direct Group IDs at that same target. Neither fact
operation returns Roles, grants, or an access decision.

`policyd` exposes exactly this decision operation:

```text
CheckAccess
```

It receives one declared operation token, canonical resource path, target
Tenant ID, and optional target Workspace ID. It returns the closed decision
`allow` or `deny`. Actor and subject account come only from the independently
validated invocation JWT; immediate caller comes only from authenticated
workload transport.

The complete behavior and status mapping are defined by
[identityd](../identityd/) and [policyd](../policyd/). These are private unary
gRPC operations. There is no HTTP mirror, watch, stream, explain operation,
path-builder operation, or reusable decision credential.

## Approved identity issuance

Identityd additionally exposes exactly:

```text
CreateSession
ExchangeSession
RevokeSession
IssueRunInvocation
```

These private unary operations are owned completely by
[identityd](../identityd/). They accept no account supplied by Authd or Edged,
no attached account supplied by Execd, and no caller-supplied issuer,
audience, key, permission, or claim bag. There is no HTTP mirror, generic
token-minting method, introspection method, Session list, or Session
administration API.

## Approved configuration and secret custody

`configd` exposes exactly:

```text
PublishConfiguration
ResolveConfiguration
PublishSecret
GetSecretMetadata
ApplyProjection
```

These are private unary operations defined completely by
[configd](../configd/) and its owned protobuf contract. Configuration is one
bounded non-secret JSON document. Secret material enters only through
`PublishSecret`, never appears in a response, and may leave custody only
through `ApplyProjection` for an exact current version into the persisted
closed Placement-scope, consumer, and purpose binding. The same closed
projection target admits an exact configuration version without returning its
bytes to Execd.

Infrastructure operators manage every scope. Exact capability-admitted product
backends may use the four management operations only at non-global scope with
validated invocation and policy. `SERVICE/svc_execd` may call only
`ApplyProjection`. An exact configured provisioner controller may call only
the two publication operations for its non-Global Execd claim's exact
Placement and Workload consumer. It must provide the opaque claim ID and
positive revision for which it computed output; other callers must omit both.
Configd validates the exact current claim before publication. No operation
lists identities or versions, returns secret material, manages bindings,
selects a provider, or accepts or returns a Kubernetes resource name.

## Approved audit dependency

`auditd` exposes exactly:

```text
RecordAuditBatch
```

It accepts a bounded batch of typed source events and returns one acceptance
per event. The finite details cover Tenant, Workspace, Identity Session,
Package declaration, App, configuration publication, secret publication,
projection, Placement, Workload, and Run mutations admitted by the owning
contracts. There is no query, export, watch, stream, redaction, deletion,
repair, or Kubernetes-resource API.

## Collections

Every collection is bounded. The owning contract states its ordering and
continuation values.

Tenant and Workspace lists use immutable-ID keyset pagination:

```text
page_size
after_tenant_id or after_workspace_id
```

The response returns at most the admitted page size and the last emitted ID
when another page exists. Continuation values are validated as untrusted
input. They are not stored server-side and do not grant visibility.

Identityd direct-Group lists use the same keyset shape over immutable Group
IDs:

```text
page_size
after_group_id
```

They return only direct Groups at the exact requested target and repeat
workload admission, invocation validation, standing, and fence checks for
every page.

Pkgd and Configd have no list operation and therefore own no page size,
continuation value, or cursor state.

## Statuses

gRPC services use only the statuses needed by an operation:

| Status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A required value is absent, malformed, conflicting, or outside its bound |
| `NOT_FOUND` | The exact visible target does not exist |
| `ALREADY_EXISTS` | An immutable identity, declaration or publication key, or audit event identity already owns conflicting content |
| `FAILED_PRECONDITION` | Current domain state forbids the request |
| `ABORTED` | An expected revision no longer matches |
| `RESOURCE_EXHAUSTED` | A documented finite input or capacity bound is reached |
| `UNAUTHENTICATED` | Required caller identity cannot be established |
| `PERMISSION_DENIED` | The caller is authenticated but not admitted |
| `UNAVAILABLE` | Required persistence or an obligatory integration is unavailable |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The call did not complete before cancellation or deadline |

Raw database, provider, Kubernetes, credential, and stack diagnostics never
cross a service boundary.

Any textual rendering of a gRPC status uses its canonical uppercase
underscore name exactly, including `OK`, `ALREADY_EXISTS`,
`PERMISSION_DENIED`, and `DEADLINE_EXCEEDED`. A language runtime's enum
spelling, casing, or concatenation never becomes a wire, telemetry, log, or
evidence value.

## Cross-cutting obligations

Only a contract-listed actual mutation constructs typed evidence in Domain and
calls `auditd.RecordAuditBatch` directly after commit. Reads, denials,
validation or dependency failures, retries, no-ops, and later realization
outcomes create no mutation evidence. A source service retains no private
audit delivery state, outbox, queue, journal, or source sequence.

Every operation emits bounded OpenTelemetry traces, metrics, and structured
logs. Trace context is the operational correlation mechanism; telemetry is
not authoritative audit evidence.

Generated descriptors are release inventory. Tests fail when a descriptor
adds a method or field without matching normative specification and canonical
behavior evidence.
