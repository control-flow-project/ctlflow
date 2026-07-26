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

## Approved tenant authorization dependencies

The capability path used by `tenantd` requires exactly these `identityd`
operations:

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

## Approved audit dependency

`auditd` exposes exactly:

```text
RecordAuditBatch
```

It accepts a bounded batch of typed source events and returns one acceptance
per event. The admitted details are Tenant or Workspace mutation evidence and
Identityd Session creation or actual revocation evidence. There is no query,
export, watch, stream, redaction, deletion, or Kubernetes-resource API.

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

## Statuses

gRPC services use only the statuses needed by an operation:

| Status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A required value is absent, malformed, conflicting, or outside its bound |
| `NOT_FOUND` | The exact visible target does not exist |
| `ALREADY_EXISTS` | An immutable identity or publication key is already owned |
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

An operation with an audit obligation constructs typed evidence in Domain and
calls `auditd.RecordAuditBatch` directly. Reads and no-op retries do not create
mutation evidence unless their contract explicitly requires it. A source
service retains no private audit delivery state, outbox, queue, journal, or
source sequence.

Every operation emits bounded OpenTelemetry traces, metrics, and structured
logs. Trace context is the operational correlation mechanism; telemetry is
not authoritative audit evidence.

Generated descriptors are release inventory. Tests fail when a descriptor
adds a method or field without matching normative specification and canonical
behavior evidence.
