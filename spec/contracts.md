---
title: Contracts
weight: 22
---

These contracts close the boundaries between the nine kernel services. Protobuf and Kubernetes API
definitions implement these semantics; implementations may not invent parallel envelopes or
alternate ownership.

## Trusted runtime context

Every admitted application hop resolves one context:

```text
tenant                 optional only for admitted global work
workspace              present for workspace-scoped work
actor                  initiating account or virtual principal; absent only for an
                       exposure explicitly admitting unauthenticated external traffic
actorAccount           attached account when actor is virtual
requester              reason the current Run exists when call is Run-derived; evidence only
immediateCaller         edged, product backend, App component, or Run
callerAccount          attached account when caller is virtual
sourcePlacement         caller Placement; absent when immediate caller is edged
sourceRuntime           concrete runtime principal; absent for kernel service callers
audience                exact target endpoint or kernel operation
requestId               unique request identity
parentCallId            previous independently issued hop, when present
traceId                 end-to-end correlation
issuedAt, expiresAt     short finite validity
```

The target runtime proxy derives this context from verified credentials and current owner facts.
Every caller-supplied protected header or metadata field is removed. A target application receives
the trusted result through one documented protocol projection.

To call a peer, a workload supplies one Package-declared dependency name and optionally its current
invocation handle. `identityd` resolves the exact binding and issues a new credential for the target
audience. A valid invocation handle preserves the original Actor; without one, the workload's
virtual principal becomes the Actor. The requester never becomes ambient authority.

## Dependency claim and binding

`pkgd` owns the immutable dependency declaration. `configd` owns provider selection and admitted
options when the dependency has a selectable provider. `execd` owns one derived claim and binding
for each consuming App or Job.

A claim contains:

```text
claim ID
consumer App or Job and component
consumer Placement
Package dependency declaration
resolution class
selected provider identity, generation, and Placement when applicable
validated consumer options
desired lifecycle
```

For an external provider, `execd` projects the claim into the selected controller's provider-owned
custom resource in the selected provider Placement namespace. The resource identifies the consumer
and its Placement without granting access to another consumer. The controller validates its own
semantics, reconciles the external resource, and reports standard generation and readiness
conditions.

`execd` accepts a selectable provider Placement only when it follows the directions in
[Model](../model/) and current constraints admit that dependency type and provider there.

For a Placement service, `execd` resolves the selected provider App, component, service contract,
and endpoint without creating an external provider resource.

For a kernel contract, `execd` resolves the fixed owning service endpoint and audience without a
provider selection or provider resource. The binding names only the Package-declared and admitted
kernel operations.

A ready binding contains only outputs declared by the provider contract:

```text
typed ordinary values
configd secret references
endpoint references and target audience
mount references
observed provider generation
ready condition
```

When a controller or provider App generates credential material, it submits that material directly
to `configd` through a write-only operation bound to the exact claim and declared output. Provider
status and the dependency binding contain only the returned Secret reference. A provider never
places secret material in status or creates a consumer-facing Kubernetes Secret.

Outputs are projected only to components listing the dependency in `uses`. A provider shared by
several consumers must issue a distinct logical namespace and binding for each. Package environment
renames rename declared outputs and cannot assign values, transform values, or introduce new
outputs. A required dependency keeps its consumer unready until the exact selected provider is
ready. Provider replacement is explicit and never occurs as fallback.

Claim lifecycle is `pending`, `ready`, `failed`, `releasing`, then removed. A failure exposes a
stable CtlFlow reason and bounded provider condition, not provider credentials or raw diagnostics.

## Peer-service binding

A provider endpoint declaration contains:

```text
provider App, component, and endpoint
service contract and compatible version
protocol: HTTP, gRPC, or TCP
streaming or upgrade capability
internal, product, or external exposure class
component port and health relationship
delegation mode: actor-preserving or workload-only
```

An internal resolution contains:

```text
consumer App or Job and component
declared dependency name
exact provider App, component, and endpoint
source and target Placements
target audience
Kubernetes Service realization reference
binding generation and readiness
```

The provider is selected during configuration, not discovered on each request. `execd` validates
the Placement direction in [Model](../model/) and realizes only the corresponding Kubernetes
network path. Endpoint rotation changes the derived resolution while preserving dependency
identity.

HTTP and gRPC bindings support actor-preserving calls. TCP bindings authenticate the source
workload but cannot claim per-request human delegation.

## Exposure and endpoint resolution

`pkgd` owns immutable endpoint and exposure declarations. `execd` owns realized endpoint readiness.
`edged` owns neither; it resolves and caches their current projection.

`tenantd` first resolves the external address to:

```text
canonical Tenant ID
optional canonical Workspace ID
matched address-binding generation
finite cache expiry
```

`edged` caches only that narrow projection under the normalized external authority and admitted
path prefix. It re-resolves through `tenantd` on a miss or after the earlier of the supplied expiry
and 60 seconds.

An exposure resolution uses:

```text
authenticated external request
resolved Tenant and optional Workspace
opaque App exposure identity
method and canonical remaining path
```

It returns:

```text
exact App, component, and endpoint
target Placement and audience
ready Kubernetes Service endpoint
trusted request context
bounded cache expiry
```

Product URL design is outside the kernel, but every route handed to `edged` must identify its
Tenant, optional Workspace, and exposure with structurally separate fixed and user-controlled
segments. Routes are inferred from current Tenant, App, exposure, and endpoint state; there is no
manually managed route record.

If the exact App is admitted for start-on-demand but has no ready endpoint, `edged` asks `execd` to
realize it and waits only within the request's bounded startup policy. Cache expiry never exceeds
the address-resolution expiry, the endpoint lifetime supplied by `execd`, or 60 seconds. Stale
resolution can delay recovery but can never authorize another target.

## Run invocation

A Run request contains:

```text
Job ID
authenticated requester
request idempotency key
optional bounded input metadata or same-Placement artifact reference
optional schedule identity
deadline or cancellation context
```

The Job supplies immutable Placement, virtual principal, attached account, Package, configuration,
dependencies, persistent slots, and execution constraints. A caller cannot override them in the
Run request.

`execd` admits the request against current Tenant, Workspace, Placement, account, Package,
configuration, dependency, and policy state. It then:

1. creates one Run for the idempotency identity;
2. realizes one Kubernetes Job with a workload-scoped ServiceAccount, runtime proxy, and only the
   admitted bindings;
3. has each concrete attempt register a distinct runtime principal through that proxy;
4. records attempts, observed status, cancellation, outputs, and log handles; and
5. makes one terminal outcome immutable.

Product-owned automation invokes this same operation. A schedule is an `execd` record attached to a
Job and uses the same Run admission path. An agent-management Package may map messages or
application events to Run requests; those activation records remain product data.

## Configuration and secret binding

`configd` resolves one immutable configuration generation for a consumer. `execd` records that
generation in desired execution and does not start a new runtime with a partially resolved set.

A secret binding request identifies:

```text
secret ID and exact version
authorized App, Job, dependency, or egress destination
target Placement and runtime generation
declared destination slot
```

For a workload, `configd` writes or updates the Placement-local Kubernetes Secret projection and
returns only its opaque binding and readiness. For `egressd`, `configd` releases material only over
the authenticated, purpose-bound operation for one admitted request. Neither path exposes a general
secret read.

## Audit envelope

Every kernel mutation and security decision emits:

```text
source service and operation
Kubernetes subject for operator actions
actor and attached account for product actions when established
immediate caller and runtime principal when applicable
Tenant, Workspace, Placement, Package, App, Job, and Run references when applicable
request and trace IDs
outcome and stable reason
bounded typed detail
occurred time and source idempotency identity
```

Credentials, secret values, application bodies, object bytes, model prompts, and program logs are
forbidden. Durable services commit this envelope to a transactional outbox with the mutation.
