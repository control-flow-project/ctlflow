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
| Persistent slot | Stable Placement-owned filesystem identity for one declared consumer slot |
| Job | Reusable finite-work definition |
| Schedule | Periodic activation belonging to one Job |
| Run | One admitted Job invocation |
| Run attempt and artifact metadata | One concrete execution attempt and its bounded outputs |
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

| Operation | Admitted caller | Purpose |
| --- | --- | --- |
| EnsurePlacement | admitted private-work owner | Materialize the one canonical Placement for an exact source |
| ResolvePlacement | kernel owner | Return current Placement identity, constraints, lifecycle, and revision |
| SuspendPlacement | operator-owned reconciliation | Block new work and apply bounded drain policy |
| ResumePlacement | operator-owned reconciliation | Revalidate and restore one suspended Placement |
| RetirePlacement | operator-owned reconciliation | Irreversibly retire one Placement generation |
| ReconcileAppGeneration | `pkgd` | Realize one exact desired App generation |
| DrainAppGeneration | `pkgd` | Stop admission and drain or retire one App generation |
| StartAppOnDemand | `edged` | Realize one admitted scale-to-zero App generation within a finite wait |
| ResolveEndpoint | `edged`, bound consumer, kernel owner | Return one exact ready endpoint projection |
| CreateJob | operator or admitted product manager | Create one reusable finite Job |
| UpdateJob | operator or admitted Job manager | Create one revised configuration for an existing Job |
| EnableJob | operator or admitted Job manager | Revalidate and admit new Runs for one Job |
| DisableJob | operator or admitted Job manager | Block new Runs without deleting Job state |
| RetireJob | operator or admitted Job manager | Irreversibly retire one Job |
| CreateRun | admitted user, App, schedule, or kernel owner | Admit one idempotent Job invocation |
| GetRun | admitted owner or observer | Return one bounded Run and attempt projection |
| ListRuns | admitted owner or observer | Return one bounded page under exact selectors |
| CancelRun | admitted owner or requester | Record cancellation and stop further execution |
| WaitRun | admitted owner or observer | Stream revisioned state until terminal, deadline, or cancellation |
| ResolveDependency | `pkgd`, runtime reconciliation | Create or refresh one exact claim and binding |
| ReleaseDependency | `pkgd`, Job/App retirement | Retire one exact consumer binding |
| ResolveRuntimeContext | `identityd`, `policyd`, `egressd`, runtime proxy | Return bounded current execution and dependency facts |
| QueryProgramLogs | admitted App, Job, or Run observer | Return one time-bounded page from the configured log dependency |
| FollowProgramLogs | admitted App, Job, or Run observer | Stream from an explicit cursor for a finite lifetime |
| AuthorizeRunArtifactTransfer | admitted Run owner or observer | Return one short-lived transfer for exact artifact metadata |

### Placement contract

`EnsurePlacement` receives one valid source tuple, effective inherited constraint revisions, and an
idempotency key. It creates at most one Placement and namespace for that source. User Placement
creation additionally requires one already-admitted App, Job, or persistent-resource intent; an
empty speculative request is rejected. The result contains Placement ID, kind, source, lifecycle,
constraint revision, realization generation, and readiness, never the native namespace name.

`ResolvePlacement` returns that same bounded projection plus effective typed constraints and an
expiry no later than 60 seconds. Every lifecycle operation is generation-bound:
`SuspendPlacement` blocks new work and drains policy-selected realization, `ResumePlacement`
revalidates every owner fact, and `RetirePlacement` is irreversible and completes only after owned
realization and retention obligations are settled.

Placement-constraint resources are the only mutation path for execution ceilings. Reconciliation
computes the intersection from global through exact source scope and rejects a desired lower-scope
record that widens an ancestor. A changed constraint does not silently rewrite admitted App or Job
intent; it marks incompatible realization blocked until the owning service changes or revalidates
that intent.

### App-realization and endpoint contract

`ReconcileAppGeneration` receives App/generation identity, expected `pkgd` revision, Placement,
components, virtual principals, attached account, immutable Package digest, one complete `configd`
generation, desired scale/lifecycle, slots, and dependency declarations. It re-resolves every owner
fact, commits desired Workload/dependency state, and only then applies Kubernetes realization.
Repeating the same generation is idempotent; different canonical intent under that generation is
`ALREADY_EXISTS`.

The result and subsequent observed reports contain only generation, component readiness, dependency
readiness, endpoint IDs, stable reasons, and execd revision. `execd` reports those facts to `pkgd`;
it never changes App intent. `DrainAppGeneration` prevents new endpoints before bounded draining,
then retains or removes persistent slots exactly as declared by the App owner.

`StartAppOnDemand` requires exact App, generation, component/exposure, and target Placement already
resolved by `pkgd`. It may only raise desired realization from zero under current constraints. It
waits within the smaller of request deadline and configured startup limit and returns the same
endpoint projection as `ResolveEndpoint`; it cannot select another generation or App.

`ResolveEndpoint` receives exact provider App/component/generation or kernel endpoint identity and,
for a consumer call, its existing dependency binding. It returns protocol, ready internal authority,
port, streaming/upgrade capability, delegation mode, endpoint generation, and finite expiry. A
not-ready exact endpoint is `FAILED_PRECONDITION`; an unknown or invisible endpoint is `NOT_FOUND`.
The result is connectivity, not application authorization.

### Job and Run contract

A Job configuration contains immutable Package version, Placement, attached account, virtual
principal, configuration generation, dependencies, persistent slots, execution class, resource
bounds, input/output declarations, and enabled state. An update may select a new compatible Package
or configuration generation only with expected revision and cannot replace Placement, account,
principal, or persistent-slot identity. Schedules have immutable Job ownership and bounded
calendar/time-zone activation plus enabled state; each activation calls `CreateRun`.

`CreateJob` receives the initial complete configuration and idempotency key. `UpdateJob` receives
the Job, expected revision, complete replacement configuration, and idempotency key. Neither is an
upsert: create conflicts with an existing immutable identity, and update requires a visible current
Job.

`CreateRun` receives Job ID, idempotency key, optional bounded input metadata or admitted artifact
reference, optional schedule ID, and effective deadline. Requester comes from authenticated context.
The Job supplies every authority and execution fact. The result is the existing or new Run ID,
admitted revision, state, and creation time.

A Run progresses:

```text
admitted -> running -> succeeded | failed | cancelled
```

Each attempt records attempt number, Kubernetes realization generation, runtime principal, start
and finish time, bounded stable reason, log handle, and output/artifact metadata. A retry is an
attempt of the same Run and cannot change input or immutable Job facts. Terminal state is immutable.
Cancellation is idempotent, prevents later attempts, and records whether an active attempt was
stopped; it cannot claim to undo an external side effect.

`ListRuns` requires exact global/Tenant fence and supports indexed Job, Placement, state, and bounded
time selectors. `WaitRun` starts from a supplied Run revision, emits only newer bounded projections,
and ends at terminal state or finite stream limit.

### Dependency and runtime-context contract

`ResolveDependency` receives exact consumer/generation/component, Placement, Package declaration
digest, and `configd` provider selection when selectable. It creates one stable claim. For an
external provider it applies the installed provider contract resource at the exact provider
Placement; for `service:*` it resolves one configured provider App endpoint; for `kernel:*` it
binds the fixed owner. Outputs not declared by the immutable contract are rejected, not retained.

A ready binding returns claim/binding IDs, consumer and provider Placements, provider generation,
typed ordinary outputs, `configd` Secret references, endpoint or mount references, readiness,
revision, and expiry. Each consumer receives a distinct binding and logical namespace. Release is
idempotent and preserves retention/evidence until the provider acknowledges cleanup.

`ResolveRuntimeContext` receives one authenticated workload/runtime or exact current owner
reference. It returns only current App component or Run, virtual principal, attached account,
Placement, workload generation, declared dependencies and bindings, lifecycle, revision, and finite
expiry. It is the bounded execution-fact projection; callers cannot enumerate another runtime or
obtain configuration values, Secret material, or native Kubernetes identity.

### Logs and artifacts

Program-log queries name one App component, Job, or Run, a bounded time interval, page size, and
opaque cursor. Results contain timestamp, stream class, bounded line/event content, and next cursor
under the configured log dependency's limits. Follow starts at an explicit cursor and is finite.
Kernel operational logs are excluded.

Run artifacts contain immutable ID, Run, attempt, declared output slot, media type, length, digest,
state, and transfer reference. `AuthorizeRunArtifactTransfer` returns one method-, artifact-,
caller-, byte-, and expiry-bound capability from the configured artifact dependency; bytes never
cross an `execd` administrative body.

## Administrative resources

Placement and source are immutable. Placement constraints are typed, scope-owned, revisioned
ceilings. Jobs and schedules are mutable only through their documented fields and lifecycle
subresources. Runs are create-only except cancellation and observed execution transitions.
Workloads, dependency claims/bindings, endpoints, attempts, logs, and artifact metadata are
read-only projections. All lists/watches use exact owner selectors and bounded pagination; no
resource exposes native object names, credentials, Secret material, or raw provider status.

## Callers and dependencies

| Callee | Purpose |
| --- | --- |
| `tenantd` | Validate exact parent Tenant or Workspace and current state |
| `identityd` | Validate attached account and virtual principal; coordinate runtime-principal lifecycle |
| `pkgd` | Resolve immutable App/Job Package, component, contract, and desired App generation |
| `configd` | Resolve complete configuration/provider generations and materialize declared Secret slots |
| `policyd` | Authorize management, Run, log, artifact, and cross-Placement operations |
| Kubernetes API | Apply and observe only admitted realization owned by `execd` |
| `auditd` | Deliver execution mutations and security decisions directly |

Provider controllers are observed through their installed Kubernetes contracts, not private
provider-specific calls. Program log, artifact, OCI, and other bulk systems are declared dependency
bindings rather than embedded `execd` implementations.

## Verification

Canonical evidence covers every Placement source and inheritance edge, lazy user materialization,
constraint narrowing/widening, suspend/resume/retire, App realization and restart, scale-to-zero and
bounded startup, endpoint expiry, Job/schedule lifecycle, idempotent Run admission, attempts,
cancellation races, terminal immutability, pages and streams, every dependency resolution class and
Placement direction, provider output validation and cleanup, runtime-context fencing, log/artifact
confinement, server-side-apply ownership and drift, restart/reconciliation, dependency outage,
cross-Tenant isolation, cancellation, concurrency, telemetry, and direct audit delivery.

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
