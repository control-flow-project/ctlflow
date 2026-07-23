---
title: execd
weight: 65
---

`execd` owns Placements, execution intent, dependency realization, ready endpoints, and general
CtlFlow workload Kubernetes resources.

## Owns

| Record | Meaning |
| --- | --- |
| Placement | Exact execution and persistent-state boundary |
| Placement constraints | Typed limits on admitted execution and dependencies |
| Workload | Desired long-running App-component realization |
| Job | Reusable finite-work definition |
| Schedule | Periodic activation belonging to one Job |
| Run | One admitted Job invocation |
| Dependency claim | Desired dependency for one consumer |
| Dependency binding | Typed ready outputs from the resolved dependency |
| Endpoint | Ready address for one component |

It serves the execution resources listed in [APIs](../apis/).

## Placement activities

- Materialize global, Tenant, Workspace, tenant-user, and workspace-user Placements.
- Create one opaque Kubernetes namespace for each materialized Placement.
- Store and evaluate inherited typed Placement constraints.
- Suspend, resume, retire, and report Placement realization.
- Enforce exact cross-Placement service-binding directions.
- Keep every persistent filesystem, dependency, workload, Job, and Run inside one Placement.

There is one canonical Placement for each valid source tuple. User Placements materialize lazily
after full admission. A failed private request leaves no empty namespace.

Placement constraints include admitted execution class, lifetime, scale, resources, persistence,
dependency types/providers, exposure, and network relationships. Operator constraints are the hard
ceiling. Lower scopes may narrow and never widen them.

## App execution activities

- Accept desired App components from `pkgd`.
- Validate App, Package, attached account standing, configuration generation, dependencies, and
  Placement.
- Validate stable component virtual principals and configure each runtime proxy to register one
  process-specific runtime principal with `identityd`.
- Realize continuous components using the suitable Kubernetes workload resource.
- Realize lifecycle components as finite work.
- Attach only declared configuration, secret, endpoint, and mount bindings.
- Create Kubernetes Services, runtime proxies, workload-scoped ServiceAccounts, and admitted
  NetworkPolicies.
- Project a rotating, workload-bound Kubernetes token within the installation's maximum lifetime
  only into its trusted runtime proxy.
- Inject standard OpenTelemetry endpoint and protected resource configuration.
- Publish bounded readiness and endpoint status to `pkgd` and `edged`.
- Suspend, resume, scale, replace, drain, and retire component realization.
- Support admitted scale-to-zero and start-on-demand.

`execd` chooses the Kubernetes resource from admitted semantic intent. Packages do not select
Deployment, StatefulSet, Pod, native object name, or ServiceAccount.

## Job and Run activities

- Create and update Jobs from immutable Job Packages.
- Bind one immutable Placement and attached account to each Job.
- Create, update, enable, disable, and delete Schedules.
- Admit manual, product-service, build, lifecycle, and scheduled Run requests.
- Create at most one Run for one Job and idempotency identity.
- Realize each attempt as a Kubernetes Job with a unique runtime principal.
- Track attempts, cancellation, observed lifecycle, output metadata, artifacts, and log handles.
- Make terminal Run outcomes immutable.

A product event service or agent-management Package invokes the ordinary Run operation. The
requester is recorded for evidence and does not replace the Job virtual principal as Actor.

## Dependency activities

- Validate every dependency against the Package declaration and provider configuration when
  applicable.
- Enforce the dependency type, provider, provider Placement, and consumer-to-provider Placement
  relationship.
- Create one stable claim per consumer and dependency.
- For an external provider, create and observe the selected controller's provider-owned custom
  resource in the selected provider Placement namespace.
- For `service:<contract>`, resolve one exact provider App, component, and endpoint.
- For `kernel:<contract>`, resolve the fixed owning kernel endpoint and admitted operations without
  provider selection.
- Accept only outputs declared by the installed provider contract and bind a distinct logical
  namespace to each consumer.
- Project ordinary values, secret references, endpoints, and mounts only to components that use the
  dependency.
- Hold required consumers unready until the exact resolved dependency is ready.
- Release claims and coordinate provider retention or cleanup.

`execd` does not interpret provider options or outputs. It never falls back to another provider or
searches for a nearest service at request time.

## Persistent state

Persistent filesystem slots become PVCs in the owning Placement and mount only into declared
components. Replacement runtime instances preserve the same slot identity. Retention or deletion is
an explicit App or Job policy.

Databases, caches, object stores, and peer services are dependency bindings. SQLite remains
application code over a persistent mount.

## Runtime proxy

Every application endpoint is fronted by a trusted, stateless runtime proxy realized by `execd`.
Only the proxy listener is reachable through a Kubernetes Service. The application listens
privately. The workload ServiceAccount credential is projected only into the proxy; application
containers receive no Kubernetes token.

The proxy:

- presents its bound Kubernetes ServiceAccount token on outbound internal calls;
- authenticates the source workload token and optional invocation JWT on inbound calls;
- removes every caller-supplied protected context field;
- injects trusted Actor, subject account, caller, Placement, and W3C trace context;
- propagates the current invocation JWT for actor-preserving HTTP and gRPC dependencies;
- obtains a fresh invocation JWT for an admitted Run-originated Actor context when required;
- exposes process-private proxy credential acquisition for declared mediated dependencies;
- supports HTTP, WebSocket, and all gRPC streaming modes;
- enforces finite request, stream, and backpressure limits; and
- produces bounded runtime-call evidence and OpenTelemetry spans.

TCP dependencies receive workload-level authentication and network admission only.

## Kubernetes realization

`execd` uses server-side apply with opaque ownership identity. It writes admitted Placement
realization and selected provider resources:

```text
Placement  -> namespace, policy, service accounts
Workload   -> continuous workload, Service, runtime proxy, telemetry configuration
Run        -> Kubernetes Job, runtime proxy, telemetry configuration
Schedule   -> Kubernetes scheduling that enters the same Run admission path
Storage    -> PVC and mount
Secret     -> reference to configd-owned Secret projection
Dependency-> provider resource or exact service endpoint
```

Native names are implementation-private. Manual native edits are drift and may be reconciled.
Deleting a native object does not delete CtlFlow intent. An unowned native object is never adopted.
`execd` cannot read secret material or write Kubernetes Secrets; `configd` owns that narrow
projection operation.

## Direct operations

| Operation family | Purpose |
| --- | --- |
| Placement | Materialize, constrain, suspend, resume, retire, and inspect |
| App realization | Reconcile, drain, start on demand, and report component status |
| Job | Configure finite work and schedules |
| Run | Create, get, list, cancel, wait, and inspect attempts |
| Dependency | Resolve claim, binding, provider readiness, and release |
| Endpoint | Resolve exact ready internal or exposed endpoint |
| Output | Query bounded logs and artifact metadata |

## Invariants

- Every Placement has one valid source and one namespace.
- Every Workload, Job, Run, dependency, endpoint, and persistent slot belongs to one Placement.
- Every Job has one immutable Package, Placement, virtual principal, and attached account.
- The attached account is valid for the Job Placement and cannot be replaced.
- Every Run inherits those Job facts and cannot override them.
- Every concrete execution has a distinct runtime principal.
- Required configuration and dependencies are one complete ready generation before startup.
- A suspended source, disabled account, revoked Package, or failed required binding admits no new
  execution. Revocation also stops active realization pinned to that Package version.
- Cross-Tenant, sibling-Workspace, and other-user service bindings are forbidden.
- `execd` owns no Tenant, account, Package, configuration value, secret material, grant, or
  application object.
