---
title: Implementation
description: Language-neutral repository, contract, persistence, test, transport, and release rules.
weight: 30
---

This page is normative for every production implementation of a CtlFlow service. It defines shared
contract ownership, schema history, canonical verification, packaging, and release boundaries. It
does not require one language's internal architecture to be copied into another language.

Kubernetes is the only realization backend. CtlFlow ships versioned plain manifests composed with
built-in Kustomize and applied with `kubectl`. Installation supplies the cluster integration, OCI
registry, storage classes, log system, trust roots, and kernel data paths.

## Monorepo shape

Each service keeps its neutral contracts, schema history, canonical tests, and production
implementations together:

```text
services/<service>/
  api/
    proto/
      v1/
        <service>.proto
    http/
      v1/
        openapi.yaml
    config/
      v1/
        binding.schema.json

  knexfile.ts
  migrations/
    0001_create_schema.ts
    0002_add_indexes.ts

  tests/
    integration/
    support/

  kubernetes/
    base/

  <implementation>/
    src/
    tests/
    Containerfile
```

A directory exists only when its contract or implementation exists. Empty language and provider
placeholders are forbidden.

| Path | Authority |
| --- | --- |
| `api/` | Callee-owned language-neutral gRPC, HTTP, configuration, and explicit Kubernetes contracts |
| `knexfile.ts`, `migrations/` | Sole ordered logical schema history |
| `tests/` | Canonical language-neutral behavior and interoperability suite |
| `kubernetes/` | Versioned plain service deployment and migration assets |
| `<implementation>/` | One independently shippable implementation and private internals |

Shared repository packages may provide generation, migration, test-mesh, and build mechanics. They
cannot own service behavior or create a second API.

Each independently deployed shipping daemon owns one `kubernetes/base/` Kustomize base containing
its ServiceAccount, workload, private and probe Services, required storage, process-private
projections, and pre-start Knex migration Job where the service is durable. Installation overlays
supply concrete OCI images, storage classes, trust and credential bindings, dependency endpoints,
and environment-specific configuration. A test-only generated workload cannot replace these
checked shipping assets as installation evidence.

Edged is a shipping sidecar rather than an independently deployed daemon. It owns a checked
Containerfile but no standalone Kubernetes base. Execd realizes the Edged container, projections,
ports, and Services as part of the application Workload that owns the public exposure.

Every hand-authored source and test file is at most 600 lines. Larger concepts split into cohesive
noun directories and operation files. Deterministic generated output is exempt but remains
drift-checked.

## API ownership

The callee owns every operation, field, enum, stream, and wire error. Protocol definitions are
hand-authored source; generated bindings are deterministic build output.

```text
service/api/proto/v1/service.proto
              |
              +----> implementation server and client bindings
```

A caller imports generated bindings from the callee's contract. It never copies or narrows the
callee contract into a caller-owned proto.

Kernel domain operations use the service-root gRPC contract. `authd`, `edged`, and `egressd`
additionally preserve the standard HTTP semantics they mediate. Kubernetes resources are
realization details unless an explicit service contract says otherwise.

Edged and Egressd have no invented gRPC mirror. Their checked OpenAPI and
strict projected binding schemas are the language-neutral contract. Execd's
checked DependencyClaim CRD is an internal multi-owner Kubernetes contract,
not a caller operation.

## Implementation independence

An implementation may use its language's idiomatic layering, functional organization, dependency
model, and libraries. It must preserve:

- the complete administrative and direct API contracts;
- validation, authentication, authorization, and Tenant fencing;
- logical state, transitions, ordering, idempotency, and concurrency;
- every declared pagination, streaming, cancellation, and failure behavior;
- the common migrated schema and revision;
- direct typed audit delivery behavior;
- health, readiness, startup, and shutdown behavior; and
- interoperability with every other supported service implementation.

An implementation cannot expose private semantic RPCs, reinterpret fields, weaken validation, use a
second persistence model, or fall back to another implementation at runtime.

## Persistence and migrations

Each durable service owns one logical database and accesses it through an implementation-private
persistence boundary. Services never read, join, write, or migrate another service's tables.

The service-root strict TypeScript Knex sequence is the only migration authority:

```text
services/<service>/knexfile.ts
services/<service>/migrations/*.ts
```

Migrations are ordered, deterministic, asynchronous, and checked in. A migration defines one
logical schema transition. SQLite is the only currently admitted provider. The Db boundary remains
replaceable so another explicitly implemented provider can later reach the same declared logical
constraints, indexes, and revision without changing Domain, API, or canonical behavior.

Migration TypeScript is compiled before execution under the repository's strict TypeScript policy.
Deployment executes the compiled JavaScript artifact; production does not transpile source at
runtime. Migration source uses explicit ESM imports ending in `.js`, just like other TypeScript
source. The repository pins one exact maintained Node Current or LTS release for migration and
canonical-test artifacts.

An implementation does not create, infer, repair, or migrate schema at startup. Deployment applies
the common migrations first. A service fails readiness when its database is absent, behind, ahead,
or incompatible.

The schema revision is the exact ordered set of compiled migration filenames applied by Knex. A
service build deterministically embeds the ordered filenames it was built against. Readiness reads
the service database's `knex_migrations` ledger and succeeds only when its ordered names equal the
embedded manifest exactly. Missing, additional, reordered, duplicate, or in-progress migration
entries fail readiness.

Knex migration exclusion is part of that compatibility check. A compatible database has exactly
one `knex_migrations_lock` row and its `is_locked` value is zero. A missing, duplicate, malformed,
or locked row fails readiness. The service never clears, inserts, or repairs that row.

There is no service-owned schema-version table, manually maintained version integer, inferred
latest-version rule, or startup repair path. Repository verification separately hashes the checked-in
migration sources and compiled artifacts so an existing filename cannot change unnoticed. The
Knex ledger remains the sole database record of applied schema history.

The current durable provider uses validated file-backed SQLite paths. Data access sits behind
narrow operation-specific persistence boundaries so a future provider can implement the same
logical contract without changing Domain, API, or migration ownership. No unimplemented provider,
fallback provider, dual write, or dormant provider branch exists.

Each provider supplies the coordination needed for its cross-record invariants. The current SQLite
deployment runs one service process per database and uses finite process-local coordination before
related persistence operations. A provider admitted for multiple service processes must
provide equivalent cross-process atomicity without changing Domain or API behavior.

Database schemas contain structural storage rules only: types, bounds, requiredness, keys, foreign
keys, uniqueness, indexes, and representation checks. Database triggers, stored procedures,
user-defined database functions, generated side effects, and provider-resident business logic are
forbidden. They do not implement domain transitions, immutability, revision changes, authorization,
audit admission, lifecycle, or cross-record decisions.

Every domain decision executes in the service implementation language through the service's Domain
layer. Only a contract-listed actual mutation produces a complete typed audit intent. Reads,
denials, validation or dependency failures, retries, no-ops, and later realization outcomes do not.
The persistence operation only projects stored state, invokes the Domain decision, and persists the
returned domain state. A database constraint is defense against corrupt storage; it is never an
alternate domain path or a substitute for the Domain decision.

Services call `auditd.RecordAuditBatch` directly after a listed actual mutation commits and before
returning success to the caller. They do not persist an audit outbox, delivery queue, retry journal,
source sequence, or audit fallback in their own database. Network calls never occur while a database
transaction is held. Transactions are bounded; mutable records use optimistic concurrency;
retryable operations use their contract-defined identity.

## Kubernetes ownership

`execd` writes general workload realization resources. It uses server-side apply and stable opaque
ownership labels for:

- Placement namespaces;
- workload, Service, scheduling, policy, volume, and ServiceAccount resources;
- trusted runtime proxies; and
- selected provider controllers' custom resources.

Execd receives a finite installation-owned map from admitted provisioner IDs
to exact controller ServiceAccount subjects. It does not discover controllers
by label, accept a caller-supplied subject, or infer authority from
reachability.

An admitted HTTP Package exposure runs the shipping Edged image as a sidecar
in a Tenant or Workspace continuous application Pod. Only the Edged port is
selected by the public Service; the application port is loopback-private.
Execd writes the strict non-secret Edged binding and cannot supply a
caller-selected upstream. Each sidecar receives its own projected Pod-bound
token with audience `ctlflow-edged` and its own Identityd trust mount. Those
projections are not mounted into the application container.

An Egressd binding runs the shipping Egressd image with one exact HTTPS
origin, one exact consumer ServiceAccount, and disjoint Configd-origin
non-secret and secret projections. Execd or an installed provisioner may
realize that workload, but Egressd alone enforces the HTTP rule set. The
consumer reaches only the purpose-bound private Service. Installation-owned
workload-token verification parameters and the finite upstream TLS trust
bundle are separate process-private bootstrap projections; neither comes from
the consumer or from a binding rule.

`configd` has one disjoint Kubernetes write boundary: Secret custody and authorized ConfigMap or
Secret projections in exact Placements. It cannot write another resource kind, and `execd` never
receives configuration or secret material.

Kernel installation resources are applied by `ctlflow init` and release operations. Installed
provider controllers own their provider-specific custom resources and external systems. Generated
secret outputs enter through `configd`; provider status contains only Secret references.

Unchanged desired generation produces no semantic Kubernetes change. Native object deletion or
editing does not mutate CtlFlow domain intent; `execd` reports or reconciles drift. An unowned native
object is never adopted automatically.

Ownership verification and mutation form one optimistic Kubernetes operation. When an exact object
is absent, the owner uses create-only semantics; an intervening create is a collision and is never
adopted. When an exact object exists, update carries its observed `metadata.resourceVersion`.
Deletion carries its observed UID and resource version as preconditions. A stale update or delete
fails without mutating the replacement object and is handled by a later reconciliation.

## Canonical tests

Each service-root `tests/` directory owns all language-neutral behavior. The same TypeScript tests
run unchanged against every production implementation and supported mixed-service constellation.
Inputs, expected results, and assertions never branch by implementation.

Canonical tests use:

- generated clients from service-root contracts;
- shipping service processes;
- real Knex-migrated file-backed databases;
- real dependency services through public contracts;
- production Kubernetes workload authentication, invocation JWT validation, authorization, and
  runtime proxies;
- real Kubernetes realization where the behavior requires it;
- a real OpenTelemetry Collector for propagation and export evidence;
- restart, cancellation, deadline, and controlled external-boundary failure; and
- every declared bounded collection, pagination, and stream.

One service test command owns one suite-scoped mesh. Before test files run, the mesh acquires the
single reusable Minikube profile named by the checked test-toolchain manifest, deploys one real
OpenTelemetry Collector workload inside that profile, and resolves one gated production artifact for each selected
implementation. Minikube uses its Docker driver and containerd runtime at the exact versions in
that manifest. The profile is reusable across serial test commands; ignored `.temp` contains the
resolved Minikube binary, flattened kubeconfig, session material, and generated workload state.
Every acquisition verifies the driver, runtime, Kubernetes version, control-plane health, and
declared profile identity before idempotently applying the complete test constellation. An
unhealthy or differently configured profile fails closed rather than being silently replaced.
Ordinary teardown never deletes the profile.

Shipping service artifacts and admitted service-owned contract stubs run as Kubernetes workloads
inside that profile. A canonical suite never routes a Kubernetes Service back to a daemon running
on the host. Host test code reaches private test endpoints only through an explicit suite-owned
Kubernetes port-forward. Deployment, ServiceAccount identity, projected workload token, Service,
probe, volume, migration Job, restart, and dependency routing behavior therefore remain in the
tested path. Suite-owned workloads and port-forwards remain active until the owning context or
suite finishes. Test files never create another cluster, Collector, or publication.

A gated production artifact is content-addressed by every source, contract, generated-input,
toolchain, lock, diagnostic manifest, and publisher input that can affect it. The first request for
that exact fingerprint publishes and verifies the artifact into the repository-local ignored
`.temp` cache. Later service test commands validate the immutable cache inventory and file digests
and reuse that artifact without republishing. A missing, partial, corrupt, differently tooled, or
differently fingerprinted entry is a cache miss and is rebuilt through the same release gate; it
is never accepted as a fallback. Tests therefore publish once per effective source revision, not
once per file, shard, or command invocation.

One canonical suite uses one migrated database and shipping service workload for ordinary serial
tests. Tests use unique opaque record IDs and explicitly restore mutable dependency modes. A test
that corrupts schema, replaces the process, or otherwise cannot restore isolation owns a separate
service context or runs as the final destructive test. The shared cluster issues fresh finite
workload credentials and never assumes one startup token outlives its bound Pod.
Collector-outage evidence uses mesh-owned suspend/resume controls and restores the shared Collector
before the test completes. One global teardown stops shared processes and releases suite-owned
resources even after failure.
It does not destroy the reusable test cluster or retained `.temp` diagnostics; destructive cleanup
is an explicit operator action. Validated content-addressed publication artifacts likewise remain
in the ignored cache for later commands.

Mocks, in-memory repositories, caller-owned substitute kernel services, and caller-local
handwritten protocol servers do not establish product behavior. Controlled processes are
permitted for external systems outside the kernel constellation.

Edged tests place the real Edged process and a controlled loopback
application in one Pod. Egressd tests use the real Egressd process and a
separately controlled external HTTPS origin. Those fixtures exercise an
external boundary; they are not substitutes for either shipping service.

A kernel dependency without a production implementation may provide one service-owned contract
stub under its own service root. The stub uses the callee-owned generated contract, runs as a real
Kubernetes workload under the callee's ServiceAccount and Service, and implements only explicit
finite behavior required to exercise callers. It may provide a separately bound test-control
surface for deterministic dependency outcomes. That surface is never part of the service
contract, is unreachable outside the test namespace, and cannot weaken caller authentication or
request validation.

A service-owned contract stub can establish the calling service's request mapping, authentication,
retry, timeout, ordering, idempotency, and failure handling. It is never release evidence for the
stubbed service and never satisfies that service's canonical suite. Once any production
implementation of the dependency exists, canonical constellation tests use that implementation;
the stub cannot become a fallback. Stub source, image, manifests, and tests remain owned by the
callee service rather than copied into each caller.

Every public operation has direct success evidence and every specified validation, authentication,
authorization, dependency, concurrency, cancellation, lifecycle, and failure result has an owning
test. Descriptor, migration, HTTP-surface, and evidence inventories fail when an operation lacks
coverage.

Each service checks in one service-root evidence manifest. It maps every
generated RPC or public route and every documented result to an exact ordinary
test file and test title, and lists the exact repository commands for every
applicable build, canonical test, implementation-local test, shipping-container,
and migration-container release gate.
A verifier rejects missing descriptor members, stale or duplicate test
ownership, nonexistent tests, unowned documented results, and unknown manifest
entries. The manifest is an inventory only; it does not introduce scenario
identifiers, a custom test DSL, runtime dispatch, or implementation-dependent
expectations.

Implementation-local tests are allowed only for evidence that cannot apply to another
implementation, such as compiler, packaging, native-publication, provider-library, or memory-safety
gates. They cannot duplicate or weaken wire-visible behavior.

## Process and transport

Every service is independently buildable, deployable, restartable, and observable. Kernel gRPC
authenticates the immediate bound Kubernetes ServiceAccount token. An optional `identityd`
invocation JWT carries subject-account and Actor context under the installation's internal
audience. Long-lived clients and connection pools are reused. Concurrency, queues, bodies, streams,
retries, and shutdown periods are finite and cancellation-aware.

Installation configuration supplies the expected Kubernetes token issuer, internal audience,
maximum token lifetime, and verification-key source. Services validate bound tokens locally, cache
keys for a finite owner-supplied lifetime, and refresh only on expiry or an unknown key ID.
Validation never accepts an unsigned token, another audience, an overlong lifetime, or a
caller-asserted ServiceAccount name. It does not add a TokenReview call to each request.
The sole purpose audience is `ctlflow-edged`, projected only into an
Execd-created Edged sidecar and accepted by Identityd only for
`ExchangeSession`.

Kernel bootstrap trust and credential material arrives only through process-private file
projections. It is never an environment value or `configd` record. In particular, only `identityd`
receives the active invocation-signing key set; other services receive public verification
material through its private operation.

Only `authd` and `edged` have public listeners. Every other kernel service is reachable only through
a private Kubernetes Service. Public TLS is terminated by the installation ingress. The private
gRPC listener uses installation-provisioned server TLS so operator port-forwards and internal
clients validate the intended service endpoint. That server identity never authenticates the
caller. An admitted kubeconfig client certificate authenticates an operator; a bound Kubernetes
workload token authenticates an internal caller.

Egressd is private HTTP rather than gRPC. It validates the bound workload
token in `Proxy-Authorization` and consumes that header before applying the
configured external HTTP rule. Its ordinary `Authorization` header remains
rule-controlled upstream data. Its domain listener supports bounded HTTP/1.1
and HTTP/2; its probe listener remains separate.

Edged's public listener receives traffic only through the installation
ingress. Its application upstream is fixed to loopback by the binding
document. It uses its own projected workload token for the private Identityd
call and never uses a browser credential as transport authentication. That
token uses the fixed `ctlflow-edged` audience; the colocated application does
not receive its token or Identityd trust projection.

A private service exposes direct gRPC over TLS on an HTTP/2-only listener and health probes on a
separate HTTP/1.1-only listener. The probe listener serves only `/healthz` and `/readyz`; it never
dispatches a domain RPC or accepts identity metadata. Both listeners use separately configured,
explicit addresses and ports.

Health proves process liveness. Readiness proves compatible schema, required local custody, and
ability to serve the declared generation. A dependency outage changes readiness or operation status
and never activates a hidden fallback path.

## Telemetry implementation

Every implementation uses OpenTelemetry APIs and SDKs, W3C Trace Context, and OTLP as defined in
[Telemetry](../telemetry/). Instrumentation is explicit production code or supported compile-time
instrumentation; runtime patching, implementation-specific propagation, and custom trace envelopes
are forbidden.

Export is asynchronous and bounded. Collector failure cannot block a domain operation, fail
readiness, create an unbounded queue, or satisfy audit delivery. Installation configuration supplies
the Collector endpoint and exporter custody before the kernel starts. `execd` supplies admitted
settings to managed workloads.

The release pins the upstream OpenTelemetry Collector artifact by digest and deploys it through the
same plain Kubernetes manifest and Kustomize path as other installation infrastructure. CtlFlow
does not fork the Collector protocol or introduce a custom telemetry daemon.

Instrumentation and exporter packages are production dependencies and must pass every
implementation's compilation, native publication, security, and performance gates. Services use
the same stable service and operation names across implementations.

## Release evidence

An implementation is releasable only when it:

1. builds independently into its production artifact;
2. serves the complete shared descriptors without drift;
3. starts against a freshly Knex-migrated database;
4. rejects every database whose exact ordered Knex migration ledger differs from the artifact's
   embedded manifest;
5. passes the unchanged canonical service suite;
6. passes required mixed-implementation constellation suites;
7. passes implementation-specific release gates;
8. passes Kubernetes installation and upgrade verification; and
9. proves complete OpenTelemetry propagation, redaction, and bounded Collector failure behavior;
10. contains no unexpected compiler, generator, trimmer, or native-compiler diagnostic; and
11. leaves the normative specification and generated inventories current.

The shared service-root assets define the service. An implementation supplies one interchangeable
realization.

Language-specific implementation rules are defined in [C#](../csharp/).
