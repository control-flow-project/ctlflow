---
title: Implementation
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
    kubernetes/
      v1alpha1/
        openapi.yaml

  knexfile.ts
  migrations/
    0001_create_schema.ts
    0002_add_indexes.ts

  tests/
    integration/
    support/

  <implementation>/
    src/
    tests/
    Containerfile
```

A directory exists only when its contract or implementation exists. Empty language and provider
placeholders are forbidden.

| Path | Authority |
| --- | --- |
| `api/` | Callee-owned language-neutral wire contracts |
| `knexfile.ts`, `migrations/` | Sole ordered logical schema history |
| `tests/` | Canonical language-neutral behavior and interoperability suite |
| `<implementation>/` | One independently shippable implementation and private internals |

Shared repository packages may provide generation, migration, test-mesh, and build mechanics. They
cannot own service behavior or create a second API.

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

Administrative Kubernetes resources use the service-root OpenAPI contract. Direct runtime and
service-to-service operations use the service-root gRPC contract. `edged` and `egressd` additionally
preserve the standard HTTP semantics they mediate.

## Implementation independence

An implementation may use its language's idiomatic layering, functional organization, dependency
model, and libraries. It must preserve:

- the complete administrative and direct API contracts;
- validation, authentication, authorization, and Tenant fencing;
- logical state, transitions, ordering, idempotency, and concurrency;
- pagination, watch, streaming, cancellation, and failure behavior;
- the common migrated schema and revision;
- transactional audit-outbox behavior;
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
logical schema transition. Provider-specific syntax is allowed only when each supported provider
reaches the same declared logical constraints, indexes, and revision.

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

The required durable provider uses validated file-backed SQLite paths. Data access sits behind
narrow operation-specific persistence boundaries so every supported provider implements the same
logical contract without changing Domain, API, or migration ownership.

A domain mutation and its audit outbox entry commit atomically. Network calls never occur while a
database transaction is held. Transactions are bounded; mutable records use optimistic concurrency;
retryable operations use idempotency identities.

## Kubernetes ownership

`execd` writes general workload realization resources. It uses server-side apply and stable opaque
ownership labels for:

- Placement namespaces;
- workload, Service, scheduling, policy, volume, and ServiceAccount resources;
- trusted runtime proxies; and
- selected provider controllers' custom resources.

`configd` has one disjoint Kubernetes write boundary: Secret custody and authorized projections in
exact Placements. It cannot write another resource kind, and `execd` never receives secret
material.

Kernel installation resources are applied by `ctlflow init` and release operations. Installed
provider controllers own their provider-specific custom resources and external systems. Generated
secret outputs enter through `configd`; provider status contains only Secret references.

Unchanged desired generation produces no semantic Kubernetes change. Native object deletion or
editing does not mutate CtlFlow domain intent; `execd` reports or reconciles drift. An unowned native
object is never adopted automatically.

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
- bounded collections, pagination, watches, and streams.

One service test command owns one suite-scoped mesh. Before test files run, the mesh starts one
test Kubernetes cluster, one real OpenTelemetry Collector, and one gated production artifact for
each selected implementation. Those shared fixtures remain active until the entire service suite
finishes. Test files never create another cluster, Collector, or publication.

Each test file receives its own migrated database, ports, invocation authority, and shipping
service process from that mesh, so schema mutation, restart, and process failure remain isolated.
The shared cluster issues fresh finite workload credentials for each isolated context rather than
assuming one startup token outlives the suite. Collector-outage evidence uses mesh-owned
suspend/resume controls and restores the shared Collector before the test releases its context.
One global teardown stops shared fixtures and removes their artifacts even after failure.

Mocks, in-memory repositories, substitute kernel services, and handwritten protocol servers do not
establish product behavior. Controlled processes are permitted only for external systems outside
the kernel constellation.

Every public operation has direct success evidence and every specified validation, authentication,
authorization, dependency, concurrency, cancellation, lifecycle, and failure result has an owning
test. Descriptor, migration, HTTP-surface, and evidence inventories fail when an operation lacks
coverage.

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

Kernel bootstrap trust and credential material arrives only through process-private file
projections. It is never an environment value or `configd` record. In particular, only `identityd`
receives the active invocation-signing key set; other services receive public verification
material through its private operation.

Only `authd` and `edged` have public listeners. Every other kernel service is reachable only through
a private Kubernetes Service. Public TLS is terminated by the installation ingress. Internal
transport encryption may be supplied by the Kubernetes network substrate, but no implementation
may require a private application certificate or treat network reachability as caller identity.

A private service exposes direct gRPC on an HTTP/2-only listener and health probes on a separate
HTTP/1.1-only listener. The probe listener serves only `/healthz` and `/readyz`; it never dispatches
a domain RPC or accepts identity metadata. Both listeners use separately configured, explicit
addresses and ports. A protocol-negotiating plaintext listener is forbidden because it cannot
reliably select HTTP/2 without TLS.

An aggregated administrative API listener is the exact Kubernetes-native exception: it uses the
serving certificate and request-header client authentication provisioned for API aggregation.
Those credentials and forwarded operator headers are scoped to that listener and are never accepted
by the service's direct gRPC listener.

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
