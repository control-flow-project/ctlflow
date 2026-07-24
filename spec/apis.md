---
title: APIs
weight: 20
---

CtlFlow exposes aggregated administrative resources, direct kernel operations, and mediated
application traffic. All surfaces share one domain model and one owning service per record.

## Operator administration

The operator CLI calls the Kubernetes API server. Each CtlFlow API group is registered through
Kubernetes API aggregation and served by its owner.

```text
 ctlflow
    |
    | HTTPS + kubeconfig credential
    v
 Kubernetes API server
    |
    +-- authenticate Kubernetes subject
    +-- authorize API group, resource, and verb
    +-- attach aggregation identity
    v
 owning CtlFlow extension API
    |
    +-- enforce CtlFlow management boundary
    +-- validate domain invariants
    +-- mutate only its own store
```

CtlFlow domain records are not CRDs and are not stored in Kubernetes etcd. Aggregated resources use
Kubernetes discovery, metadata, status, error, list, watch, and content-negotiation conventions.
Each aggregated listener uses Kubernetes-managed serving certificates and request-header client
authentication. It accepts forwarded operator identity only from the authenticated Kubernetes API
server, never from a direct caller or another service listener.

## Product administration

Tenant-facing products expose selected management operations through their own UI or API. The
browser enters through `edged`; the authenticated product backend App invokes the same
owning-service use case as the aggregated API.

```text
 product UI -> edged -> product backend App -> owning service
```

The product surface may offer a purpose-built form and JSON review for one operation. It cannot
change semantics, bypass a field, or create a second record shape.

The aggregated adapter trusts only the Kubernetes-authenticated operator subject and its RBAC
decision. The product adapter validates its backend workload and invocation JWT, then the owning
service calls `policyd.CheckAccess` for the exact management operation and resource path before
entering the same use case. A product backend never calls an aggregated listener or presents a
Kubernetes operator identity.

## Public authentication

Browser authentication uses the public HTTP contract owned by `authd`. It covers login options,
begin, provider callback, and logout. `authd` translates those operations into private `tenantd`
and `identityd` calls; it does not expose an administrative resource or proxy arbitrary
`identityd` operations.

`identityd` has no Ingress or public HTTP API. Its Session, identity, and invocation-token
operations are private gRPC and aggregated administrative resources only.

## Administrative resource inventory

| API group | Resources | Owner |
| --- | --- | --- |
| `tenancy.ctlflow.com/v1alpha1` | `tenants`, `workspaces` | `tenantd` |
| `identity.ctlflow.com/v1alpha1` | `users`, `groups`, `groupmembers`, `memberships`, `identitylinks`, `sessions`, `ssoproviders`, `admissionpolicies`, read-only `virtualprincipals` and `runtimeprincipals` | `identityd` |
| `policy.ctlflow.com/v1alpha1` | `roles`, `rolebindings`, `accessgrants`, create-only `accessreviews` | `policyd` |
| `packages.ctlflow.com/v1alpha1` | `packages`, `apps`, and read-only `artifacts`, `servicecontracts`, and `exposures` | `pkgd` |
| `config.ctlflow.com/v1alpha1` | `configurations`, `secrets`, `providerconfigurations` | `configd` |
| `execution.ctlflow.com/v1alpha1` | `placements`, `placementconstraints`, `jobs`, `jobschedules`, `runs`, and read-only `workloads`, `persistentslots`, `dependencyclaims`, `dependencybindings`, `endpoints`, `runattempts`, and `runartifacts` | `execd` |
| `egress.ctlflow.com/v1alpha1` | `egressdestinations`, `egresspolicies`, create-only `egressreviews` | `egressd` |
| `audit.ctlflow.com/v1alpha1` | read-only `auditevents` and mutable `auditexports` | `auditd` |

Every scoped resource carries an immutable global or Tenant boundary. Workspace and user resources
also carry their immutable parent references. A global User must be a non-login service User.
Package visibility and ownership are explicit fields; they are not inferred from Kubernetes
namespace.

Write-only secret material is accepted only through a named `material` subresource. Reads return
metadata and readiness but never the submitted value or native Secret name. Logs, cancellation,
artifacts, transfer, suspension, revocation, and other non-CRUD lifecycle operations are explicit
subresources.

## Resource conventions

- `metadata.name` is the opaque server-allocated ID unless a resource explicitly defines an
  immutable publication key.
- `spec` is desired domain state; `status` is observed state and conditions.
- Mutable records use `metadata.resourceVersion` for optimistic concurrency.
- Retriable mutations accept an idempotency key.
- Errors are Kubernetes `Status` documents with stable reason and field detail.
- Internal addresses, credentials, payloads, database errors, and provider diagnostics are not
  exposed.
- A record outside the caller's visibility is returned as not found.

Only documented selectors are accepted. Every Tenant collection supports exact Tenant selection.
Child collections support exact owner selection. A selector is added only for a stable indexed
field.

## Collections and streams

Every collection is bounded:

- requests use `limit` and an opaque `continue` token;
- responses return `metadata.continue` and `metadata.resourceVersion`;
- continuation preserves query, authorization fence, and ordering;
- every page is authenticated and authorized independently; and
- clients never fetch all pages implicitly.

Live administrative collections may support Kubernetes watch from a resource version. Evidence
queries additionally require a bounded time range. Logs use bounded pages and finite follow streams.

## Direct kernel operations

Direct service APIs are versioned, language-neutral contracts owned by the callee. Kernel
service-to-service contracts use gRPC. Public HTTP mediation remains HTTP.

| Service | Direct operations |
| --- | --- |
| `tenantd` | ResolveTenant, ResolveWorkspace, GetLifecycle, AcknowledgeLifecycleStep |
| `authd` | Public HTTP Options, Begin, Callback, Logout, and private operational probes |
| `identityd` | Login transaction, Session exchange/revocation, invocation/key, principal, runtime, proxy-credential, and identity-scope operations |
| `policyd` | CheckAccess, ExplainAccess, BuildResourcePath |
| `pkgd` | Package publication/resolution, App lifecycle/realization, immutable contract/exposure, baseline, and artifact-transfer operations |
| `configd` | Validation/resolution, provider selection, write-only material, workload/egress materialization, and scope operations |
| `execd` | Placement, App realization, endpoint, Job/Run, dependency, runtime-context, log, and artifact operations |
| `edged` | Public ProxyRequest plus private preview, cache, drain, and probe operations |
| `egressd` | Private HTTP ForwardHttp plus PreviewEgress and probes |
| `auditd` | RecordAuditBatch, bounded query/follow, export/transfer, payload removal, and probes |

Every internal direct request carries:

```text
authorization: Bearer <bound Kubernetes ServiceAccount token>
ctlflow-invocation: Bearer <identityd invocation JWT>   when acting on behalf of an Actor
traceparent: <W3C Trace Context>
tracestate: <W3C vendor state>                         when present
```

The receiver validates immediate workload identity before parsing the operation. The optional
invocation JWT has the installation's internal audience, expires no later than 60 seconds after
issuance, and supplies subject-account and Actor context without permissions. A request may name a
target record, but body fields cannot override authenticated workload, subject, Actor, attached
account, Tenant, Workspace, Placement, or Run facts. The callee independently fences every target.

A missing, invalid, or expired required token is unauthenticated. A valid workload or invocation
identity that is not admitted for the operation is permission denied. A target outside the
caller's visibility remains not found.

Trace propagation follows [Telemetry](../telemetry/), whose W3C trace and span identity is the sole
transport correlation model. Public cookies, public bearer tokens, protected identity headers, and
W3C baggage are never forwarded into an internal operation.

### Direct-operation rules

Each direct operation has one intent-specific method. A protobuf service cannot expose a generic
command, arbitrary resource envelope, untyped selector, property bag, or operation-family method.
The callee owns the request, response, and error contract. Callers use the callee's contract rather
than defining a caller-shaped copy.

Requests contain only operation input. Authenticated workload, Actor, attached account, Tenant,
Workspace, Placement, runtime, request deadline, and trace facts come from validated transport
context unless the operation must name one of them as a target. Responses contain bounded domain
results and owner-supplied revisions or expiries; they never contain credentials, native
Kubernetes names, provider payloads, or another service's administrative record.

The common gRPC status contract is:

| Status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A required field is absent, malformed, non-canonical, conflicting, or outside a declared finite bound |
| `NOT_FOUND` | The exact visible target does not exist; invisible and cross-fence targets use the same result |
| `ALREADY_EXISTS` | An immutable publication key or relationship is already bound to a different canonical body |
| `FAILED_PRECONDITION` | Current lifecycle or a required owner fact forbids the otherwise valid operation |
| `ABORTED` | An expected revision or concurrency precondition no longer matches |
| `RESOURCE_EXHAUSTED` | A declared finite request, stream, queue, or admission limit is reached |
| `UNAUTHENTICATED` | Required immediate or invocation identity cannot be established |
| `PERMISSION_DENIED` | Identity is valid but is not admitted to this operation |
| `UNAVAILABLE` | Required owner state, persistence, or dependency cannot currently establish a safe result |
| `CANCELLED` / `DEADLINE_EXCEEDED` | Caller cancellation or the effective deadline ends unfinished work |

An operation may narrow this table but cannot reinterpret a status. Dependency and provider errors
map to a bounded stable owner reason; raw diagnostics do not cross the boundary.

Every retryable mutation requires an idempotency identity. The same caller, target, operation, and
canonical input returns the same accepted result. Reuse with different input is
`ALREADY_EXISTS`. Mutable records additionally require an expected positive revision; mismatch is
`ABORTED`. A mutation commits its audit-outbox intent atomically before returning success.

Direct lists use a finite `page_size` and opaque `page_token`; the response returns an opaque
`next_page_token` and owner revision. Direct follow or wait operations require an explicit starting
cursor or target revision, send finite messages, enforce backpressure, and end on deadline,
cancellation, terminal state, or owner-defined maximum lifetime.

Generated descriptors are release inventory. Canonical tests must prove every advertised method,
success result, admitted validation and status outcome, pagination or streaming boundary,
authentication and authorization path, cancellation, dependency failure, telemetry, and audit
obligation. An operation absent from the callee-owned API definition does not exist.

## Application endpoints

Applications own their GraphQL, HTTP, gRPC, WebSocket, and domain schemas. A Package declares only
the endpoint protocol, exposure, and service-contract identity needed to connect it.

`edged` resolves an external request from Tenant/Workspace address, Package exposure, and ready
`execd` endpoint. Internal consumers receive exact resolved endpoints from declared service
bindings and call them through Kubernetes networking.

## Bulk data

Administrative bodies contain metadata, not bulk bytes. Container images use OCI registry
protocols. Application objects, Run artifacts, and audit exports use configured dependency
transfers. Logs use bounded query and follow operations. Secret material uses write-only,
purpose-bound operations.

The mandatory cross-service envelopes and state transitions are defined in
[Contracts](../contracts/).
