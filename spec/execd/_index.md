---
title: execd
description: Placement, Workload, and Run intent plus Kubernetes realization.
weight: 65
---

`execd` is the private authority for Placement, Workload, and Run intent and
the sole general boundary from CtlFlow execution intent to Kubernetes. Its
only caller-visible API is the unary gRPC contract in
`services/execd/api/proto/v1/execd.proto`.

**Wire reference:** [execd gRPC API](../apis/execd/)

## Owned records

Execd owns:

- Placement identity, target, parentage, constraints, desired state, and
  realization status;
- reusable continuous or finite Workload intent and its admitted Package
  snapshot;
- Workload-private storage, configuration targets, dependency selections,
  interfaces, and endpoint status;
- one immutable Run admission for one finite Workload revision; and
- the mapping from those records to Execd-owned Kubernetes resources.

Pkgd remains authoritative for Apps, Package generations, components,
artifacts, interfaces, dependencies, and exposures. Configd owns
configuration, secrets, and their projections. Identityd owns Run invocation
identity. Installed provisioner controllers own provider-specific resources
and claim status.

There is no separate Job record. A finite Workload is reusable intent; a Run
is one admitted execution. Callers never submit Kubernetes kinds, manifests,
namespaces, native names, provider resources, or configuration or secret
bytes.

## Placement

A Placement has one immutable target:

| Target | Required parent |
| --- | --- |
| Global | none |
| Tenant | Global |
| Workspace | Tenant with the same Tenant ID |
| User | Tenant with the same Tenant ID |

The User anchor is a canonical `user:` or `service:` account principal.
Parentage is exactly `Global -> Tenant -> Workspace|User`; skipped levels and
cycles are invalid.

Constraints admit a subset of continuous and finite modes and set positive
ceilings for replicas, Run duration, attempts, CPU, memory, persistent
storage, and dependency-type provisioners. A child can only narrow its
parent's effective constraints and must retain the same provisioner for a
retained dependency type. A Placement update cannot invalidate an existing
child Placement or Workload.

Installation configuration gives Execd one finite map from each admitted
provisioner ID to the exact Kubernetes ServiceAccount subject of its installed
controller. This mapping is process configuration, not an Execd record or
caller operation. A Placement cannot declare an unknown provisioner.

Desired state is `ACTIVE`, `SUSPENDED`, or terminal `RETIRED`. Suspension
stops continuous execution and rejects new Runs while preserving storage.
A Placement is effectively active only while it and every ancestor are
active; ancestor suspension suspends descendant realization without changing
their stored desired state. Retirement requires child Workloads and
Placements to be retired and all Runs terminal.

## Workload

A Workload belongs to one Placement and names one App component. Execd calls
`pkgd.GetApp`, requires the App's Placement and scope to equal the stored
Placement exactly, then calls `pkgd.GetPackage` for the App's desired
generation. It admits and stores the exact component artifact, selected
interfaces, dependencies, and Package generation. Cross-Placement or
cross-scope Apps are concealed as `NOT_FOUND`.

The declaration must remain within the effective Placement constraints.
Creating a Run additionally requires an effectively active Placement and an
active, `READY` finite Workload. Readiness ensures every projection,
dependency binding, dependency output, and storage slot in the immutable Run
snapshot has already been established.

A Workload declares exactly one mode:

- continuous: positive replicas and selected component interfaces; or
- finite: positive Run duration and attempt ceiling plus an Actor for every
  non-Global target.

Global finite Workloads have no Actor. A configured Actor is declaration
state, not caller identity and not an attached-account field.
Workload retirement requires every Run to be terminal. A retired Workload is
terminal and cannot be redeclared active or suspended.

A Workload's admitted package identity — App, Package, Package generation, and
component — is immutable for its Workload ID, exactly as its Placement is.
Redeclaring the same Workload ID after the App moved to another generation is
`FAILED_PRECONDITION`. This is what keeps a Workload's authority fixed for the
life of its identity: the derived ServiceAccount subject is stable, so an
already realized Pod can never acquire a later generation's operations while
it is still running. Adopting a new generation is a new Workload ID, and
therefore a new subject, a new admission, and a new operation snapshot.

Configuration targets name an exact Configd configuration or secret version
and one purpose. Execd passes the stored Placement target, Workload as
consumer, and purpose to `configd.ApplyProjection`; it never receives content
or a native coordinate. Direct targets are unique by data kind and purpose.

Every Package dependency has exactly one selection. Execd chooses only the
provisioner fixed by the effective Placement constraints, applies any
purpose-bound parameter projections, and creates one deterministic
`DependencyClaim`. Missing, stale, rejected, or conflicting claims and
outputs make realization `BINDING_UNAVAILABLE`; they do not create another
caller-visible operation.

Persistent storage slots have stable IDs, positive capacity, and unique,
normalized absolute POSIX mount paths. `/`, `/dev`, `/proc`, `/sys`,
`/run/ctlflow`, and descendants of those reserved roots are invalid. Slots
cannot shrink or disappear before Workload retirement. Storage admits one
continuous replica or one nonterminal Run at a time.

Only selected HTTP Package exposures on a Tenant or Workspace continuous
Workload receive an Edged sidecar. Global and User Workloads and every finite
Workload reject a public exposure. The app listener remains loopback-private
and the sidecar receives one exact target and port. A gRPC interface may be
internal but is not publicly exposed by Edged v1.

For each Edged sidecar, Execd projects a distinct short-lived Pod-bound
Kubernetes token with audience `ctlflow-edged`, the Identityd trust anchor,
and the configured telemetry endpoint. Only that sidecar mounts the Edged
token and trust projection. The application container receives the separate
[product runtime bootstrap](#product-runtime-bootstrap) and can neither read
nor substitute the Edged credential, target, or trust anchor.

## Run

`CreateRun` accepts one globally unique Run ID and one finite Workload ID. It
snapshots Placement target, Workload revision, configured Actor, admitted
Package component, resources, projections, dependencies, storage, duration,
and attempts. Later App or Workload changes do not mutate the snapshot.

For a non-Global Run, the reconciler calls `identityd.IssueRunInvocation` with
the stored Actor, Run ID, Tenant, and optional Workspace immediately before
launch. Identityd derives the attached account and returns a short-lived
invocation JWT. Execd never persists or returns that JWT. It keeps one
process-private Kubernetes credential projection current before expiry and
mounts it read-only at `/run/ctlflow/invocation/token` in only the exact Run
Pod. The Run does not start before the first valid projection exists.
Refresh failure never exposes or reuses an expired token and updates bounded
Run status. A Global Run has neither Actor nor invocation JWT.

Run phase is `PENDING`, `STARTING`, `RUNNING`, `CANCELLING`, `SUCCEEDED`,
`FAILED`, or `CANCELLED`. Terminal Runs are immutable. The first valid
`CancelRun` advances revision once; a retry while cancelling or cancelled is
idempotent, while a succeeded or failed Run is `FAILED_PRECONDITION`.
Lifecycle timestamps sourced from Kubernetes are normalized to the Run's
timeline: start is never earlier than creation, and completion is never
earlier than start. This accounts for native timestamp precision without
changing the observed phase.

## Exact API

Execd exposes exactly eleven unary RPCs:

| RPC | Purpose |
| --- | --- |
| `DeclarePlacement` | Create or revision-control one Placement intent |
| `GetPlacement` | Read one Placement |
| `ListPlacements` | List retained Placements at one exact target |
| `DeclareWorkload` | Create or revision-control one Workload intent |
| `GetWorkload` | Read one Workload and current endpoint/status projection |
| `ListWorkloads` | List retained Workloads in one Placement |
| `CreateRun` | Admit one finite execution |
| `GetRun` | Read one Run |
| `ListRuns` | List retained Runs for one finite Workload |
| `CancelRun` | Convergently request one nonterminal Run cancellation |
| `ResolveWorkloadOperationBinding` | Confirm one admitted product operation for one authenticated Workload subject |

Lists use ascending immutable-ID keyset pagination. Page size zero means 50;
an explicit size is 1 through 100. A continuation is the last emitted ID and
appears only when another record exists. Execd stores no cursor.

There is no HTTP mirror, watch, stream, wait, log, exec, route, preview,
cache, generic manifest, endpoint-resolution, dependency-management, or
administrative convenience operation.

### ResolveWorkloadOperationBinding

This operation exists only so Policyd can confirm product-operation authority.
It admits exactly one caller, `SERVICE/svc_policyd`, by exact method-specific
admission, and it **never calls Policyd**; that is what prevents authorization
recursion. It carries a workload token and trace context and no invocation JWT.

```text
ResolveWorkloadOperationBinding(service_account_subject, operation)
  -> effective Placement target, App ID, Package ID
```

`service_account_subject` is supplied by Policyd from a workload token Policyd
has already validated; Execd resolves it through its retained unique subject
index. `operation` is an untrusted selector that grants nothing by itself:
Execd confirms exact membership in the Workload's admitted operation snapshot.
Both fields are validated before any lookup: a subject outside Execd's own
derived-subject form, or an operation outside the canonical token grammar, is
`INVALID_ARGUMENT` like any other malformed request field, never a concealed
`NOT_FOUND`.

The response carries only the three facts Policyd consumes. The full admitted
operation set, Workload ID, Placement ID, revision, component ID, and package
generation are deliberately not returned.

`NOT_FOUND` is returned when the subject is unknown, the Workload or any
Placement ancestor is inactive, or the operation is not admitted for that
Workload. There is no separate active flag and no state for a caller to
interpret.

Resolution reads the subject, the operation-snapshot membership, the Workload
state, its App and Package facts, and the full Placement ancestor state from
one consistent database snapshot — a single composed query or one read
transaction. A concurrent admission update cannot combine facts from one
revision with an operation from another.

## Bounds

| Value | Admitted form |
| --- | --- |
| Placement, Workload, App, component, interface, storage, provisioner, dependency, configuration, secret, and version IDs | 1-64 lower-case ASCII characters; starts alphanumeric; remainder alphanumeric, `_`, or `-` |
| Package ID | 1-128 lower-case ASCII characters; starts alphanumeric; remainder alphanumeric, `.`, `_`, or `-` |
| Run ID | 1-128 lower-case ASCII characters; starts alphanumeric; remainder alphanumeric, `.`, `_`, or `-` |
| Account or Actor principal | Identityd canonical principal form, at most 256 characters |
| Dependency type | 1-128 lower-case ASCII characters in non-empty colon-separated declaration-ID segments |
| Dependency name | Pkgd's canonical 1-200-scalar NFC form |
| Purpose | Configd's 1-64-character lower-snake token |
| Revision, generation, duration, memory, or storage quantity | 1 through 9,223,372,036,854,775,807 |
| CPU | 1 through 1,000,000 millis |
| Memory | 1 byte through 1 TiB |
| Persistent storage | 1 byte through 1 PiB |
| Run duration | 1 second through 7 days |
| Run attempts | 1 through 10 |
| Continuous replicas | 1 through 100 |
| Mount path | normalized absolute POSIX path, 2 through 256 ASCII characters |

A Placement contains one or two unique admitted modes and at most 256 unique
dependency-provisioner selections. A Workload contains at most 256 direct
Configd targets, 256 dependency selections, 64 storage slots, and 256 selected
interfaces. One dependency contains at most 64 unique provisioning
parameters. Every repeated identifier or semantic key is unique. The complete
encoded request is at most 1 MiB.

## Mutation and idempotency

Absent `expected_revision` creates revision one. An identical create retry
returns the retained record; conflicting identity reuse is `ALREADY_EXISTS`.
An update requires the current positive revision. An identical update is a
no-op. A retry one revision behind succeeds only when the complete retained
result equals the requested result; another mismatch is `ABORTED`.

A Run ID is its retry identity. Reuse for the same Workload returns the
retained Run; reuse for another Workload is `ALREADY_EXISTS`.

Every actual Placement, Workload, Run-admission, or first-cancellation
mutation commits before directly calling `auditd.RecordAuditBatch`. No
transaction spans a dependency call. Reads, lists, denials, retries, no-ops,
and later realization outcomes create no audit event. Audit failure is
`UNAVAILABLE` and does not roll back committed state or create a local
outbox, queue, or repair path.

## Admission

An admitted infrastructure operator may call every operation. Global access
is operator-only. `ResolveWorkloadOperationBinding` is the sole exception: it
admits only `SERVICE/svc_policyd` and no operator.

Admitting a Workload also establishes its product-operation authority. In the
same transaction that admits the Workload, Execd:

- snapshots the operations declared by the admitted package component for the
  admitted generation, so authority reflects what was admitted rather than a
  later Pkgd read; and
- derives and retains that Workload's ServiceAccount subject from its own
  deterministic convention, stored uniquely and indexed for exact lookup.

Pkgd is a network dependency, and its declaration output is dependency data,
not caller input. Before persisting the snapshot, Execd itself validates the
received declared operations: canonical token grammar, no duplicate within the
generation, the per-component and per-generation bounds, and that each
operation belongs to the admitted component. A Pkgd response that violates any
of these is a dependency failure and surfaces as `UNAVAILABLE`; it is never
persisted and never mapped to caller input validation.

The snapshot is Execd persistence. It is not added to the caller-visible
admitted-component projection, and no caller may supply or influence either the
snapshot or the subject. Kubernetes realization consumes the retained subject;
it never creates or mutates that identity mapping.

A configured non-Global product backend presents its bound workload token and
invocation JWT. Execd validates the invocation, fences the exact target, and
calls `policyd.CheckAccess`. User target access additionally requires the
target account to equal invocation `sub`. Execd never caches a decision.

| RPC | Operation |
| --- | --- |
| `DeclarePlacement` | `placements.declare` |
| `GetPlacement`, `ListPlacements` | `placements.read` |
| `DeclareWorkload` | `workloads.declare` |
| `GetWorkload`, `ListWorkloads` | `workloads.read` |
| `CreateRun` | `runs.create` |
| `GetRun`, `ListRuns` | `runs.read` |
| `CancelRun` | `runs.cancel` |

Resource paths are the exact paths in [Policyd](../policyd/). Target mismatch
is concealed `NOT_FOUND`; policy deny is `PERMISSION_DENIED`; required
Identityd or Policyd failure is `UNAVAILABLE`.

## Realization

RPC success means semantic intent is committed, not that execution is ready.
One bounded restart-safe reconciler realizes only Execd-owned objects:

```text
Placement
  -> Namespace

continuous Workload
  -> ServiceAccount + projections + claims + storage
  -> Deployment + private Services
  -> Edged sidecars and Services for admitted HTTP exposures

finite Run
  -> ServiceAccount + projections + claims + storage
  -> Kubernetes Job
```

The reconciler uses stable ownership and never adopts an object whose kind,
name, or ownership markers disagree. An absent object is created with
create-only semantics. An existing object is server-side applied with its
observed Kubernetes resource version, and deletion carries the observed UID
and resource version as preconditions. A create race, stale mutation, or
ownership disagreement cannot mutate a replacement object. Native outage,
rejection, collision, missing binding, storage failure, or unready execution
updates the bounded realization or Run status; it does not change desired
intent or select a fallback.

Placement and Workload realization phase is `PENDING`, `READY`, `SUSPENDED`,
`DEGRADED`, or `RETIRED`. `observed_revision` is zero or the highest desired
revision the reconciler has evaluated. A completed degraded or pending result
advances it just as a ready, suspended, or retired result does; only a
declaration not yet evaluated remains zero. Re-observing the same phase,
reason, and desired revision is a no-op that preserves the retained status
revision and update time.

Re-observing the same Run phase, reason, attempt count, and lifecycle
timestamps is likewise a no-op that preserves the retained Run update time.
The reconciliation loop does not create periodic database writes merely to
confirm unchanged native state. Newly revised, pending, and degraded intent is
retried on the short reconciliation interval; settled native state is
re-observed on a slower finite sweep so drift remains bounded without placing
unchanged objects on the hot path.

### Product runtime bootstrap

The application container of a realized Workload receives a distro-neutral
bootstrap so the running product can make its own production Identityd and
Policyd calls. Realization projects, from Execd's own admitted configuration
and trust material:

```text
/var/run/secrets/ctlflow/token
  Pod-bound token for the Workload's retained ServiceAccount,
  installation internal audience, short expiry, kubelet rotation

/var/run/ctlflow/trust/workload-jwks.json
/var/run/ctlflow/trust/identityd-ca.crt
/var/run/ctlflow/trust/policyd-ca.crt

CTLFLOW_WORKLOAD_TOKEN_FILE
CTLFLOW_WORKLOAD_JWKS_PATH
CTLFLOW_IDENTITYD_ENDPOINT
CTLFLOW_IDENTITYD_TLS_CA_PATH
CTLFLOW_POLICYD_ENDPOINT
CTLFLOW_POLICYD_TLS_CA_PATH
CTLFLOW_WORKLOAD_TOKEN_ISSUER
CTLFLOW_WORKLOAD_TOKEN_AUDIENCE
CTLFLOW_WORKLOAD_TOKEN_MAX_LIFETIME_SECONDS
CTLFLOW_INVOCATION_ISSUER
CTLFLOW_INVOCATION_AUDIENCE
CTLFLOW_APP_ID
```

The bootstrap carries identity, trust, endpoints, validation settings, and the
admitted App ID — nothing else. Package ID, operation grants, and policy state
are not projected; the workload learns only ALLOW or DENY per decision. The
Edged exposure token keeps its distinct `ctlflow-edged` audience and remains
projected only into the Edged sidecar, never into the application container.
The configured product workload-token lifetime is at least 600 seconds, the
minimum Kubernetes admits for a projected ServiceAccount token; Execd rejects
a lower value at startup rather than emitting an invalid Pod or Job.

## DependencyClaim

The sole claim contract is
`services/execd/api/kubernetes/v1/dependency-claim-crd.yaml`. It is an
internal namespaced Kubernetes contract, not an RPC.

The API group is `execution.ctlflow.io/v1`; names are deterministic
`dpc-<32-lower-hex>`. Execd owns metadata and spec; the exact provisioner
controller owns status. Configd validates the exact current
`claimRevision`, Placement, Workload, owner annotation, and
`provisionerSubject` before accepting claim-bound publication.

Unknown fields are rejected. Execd uses strict field validation and never
adopts a conflicting claim. Claim status is only `pending`, `ready`, or
`rejected`. Ready status alone carries one opaque binding identity, positive
binding revision, and at most 64 Configd output targets uniquely keyed by data
kind and purpose. `observedClaimRevision` cannot exceed the current spec
revision.

## Statuses

| Status | Use |
| --- | --- |
| `INVALID_ARGUMENT` | Malformed field, enum, combination, bound, page, or revision |
| `NOT_FOUND` | Absent or concealed record, parent, App, component, standing, or target |
| `ALREADY_EXISTS` | Conflicting Placement, Workload, or Run identity |
| `FAILED_PRECONDITION` | Lifecycle, parent, constraint, Package, storage, interface, Actor, or terminal state forbids the request |
| `ABORTED` | Expected revision or post-dependency recheck changed |
| `RESOURCE_EXHAUSTED` | A declared finite resource or concurrency ceiling is reached |
| `UNAUTHENTICATED` | Required operator, workload, or invocation identity is invalid |
| `PERMISSION_DENIED` | Authenticated caller is not admitted or policy denies |
| `UNAVAILABLE` | Persistence or an obligatory synchronous dependency is unavailable or malformed |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The call did not complete |

Asynchronous Configd, provisioner, Kubernetes, and workload failures are
record status rather than a later transport result. Raw dependency,
credential, Kubernetes, provider, and stack diagnostics never cross the
boundary.

## Verification

Canonical evidence covers all eleven RPCs, four targets, parent narrowing,
revision/idempotency rules, pagination, Package admission, projections,
DependencyClaim ownership, storage bounds, both workload modes, Run
invocation and cancellation, operator and capability paths, required audit,
Kubernetes realization and restart, telemetry, and every documented status.
The suite uses real production dependencies and Minikube.
