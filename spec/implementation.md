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

  knexfile.js
  migrations/
    0001_create_schema.js
    0002_add_indexes.js

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
| `knexfile.js`, `migrations/` | Sole ordered logical schema history |
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

The service-root Knex sequence is the only migration authority:

```text
services/<service>/knexfile.js
services/<service>/migrations/*.js
```

Migrations are ordered, deterministic, asynchronous, and checked in. A migration defines one
logical schema transition. Provider-specific syntax is allowed only when each supported provider
reaches the same declared logical constraints, indexes, and revision.

An implementation does not create, infer, repair, or migrate schema at startup. Deployment applies
the common migrations first. A service fails readiness when its database is absent, behind, ahead,
or incompatible.

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
- production authentication, authorization, and runtime proxies;
- real Kubernetes realization where the behavior requires it;
- restart, cancellation, deadline, and controlled external-boundary failure; and
- bounded collections, pagination, watches, and streams.

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
uses authenticated service identity and exact destination audience. Long-lived clients and
connection pools are reused. Concurrency, queues, bodies, streams, retries, and shutdown periods are
finite and cancellation-aware.

Health proves process liveness. Readiness proves compatible schema, required local custody, and
ability to serve the declared generation. A dependency outage changes readiness or operation status
and never activates a hidden fallback path.

## Release evidence

An implementation is releasable only when it:

1. builds independently into its production artifact;
2. serves the complete shared descriptors without drift;
3. starts against a freshly Knex-migrated database;
4. rejects missing or incompatible schema revisions;
5. passes the unchanged canonical service suite;
6. passes required mixed-implementation constellation suites;
7. passes implementation-specific release gates;
8. passes Kubernetes installation and upgrade verification; and
9. leaves the normative specification and generated inventories current.

The shared service-root assets define the service. An implementation supplies one interchangeable
realization.

Language-specific implementation rules are defined in [C#](csharp/).
