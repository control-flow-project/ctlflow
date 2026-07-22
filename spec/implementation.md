---
title: Implementation
weight: 30
---

CtlFlow is implemented in C# on .NET and published as NativeAOT executables. Kubernetes is its only
realization backend. SQLite is the shipping service-owned database provider. Persistence remains a
provider boundary so another database implementation does not change domain or API contracts.

Installation configuration supplies the OCI registry, object-storage destination, product log
store, trust roots, and Kubernetes integration needed by the components. These are infrastructure
settings, not Tenant or application records.
An object or log store outside the cluster is reached through an infrastructure-owned Egress
Destination; its credential is never copied into the calling service.

CtlFlow ships versioned plain Kubernetes manifests composed with built-in Kustomize and applied
with `kubectl`. Helm and a CtlFlow-specific installer protocol are not dependencies.

## Service shape

Each service separates four concerns:

```text
 Domain        validated values and pure decisions
 Persistence   service-owned records and transactions
 Clients       typed calls to owning peer APIs
 Operations    application orchestration
 Host          API listeners, workers, mapping, and composition
```

Domain behavior is expressed as asynchronous static functions over explicit inputs. Dependencies
are passed explicitly; mutable global state and service locators are forbidden. Framework, wire,
database, and Kubernetes types do not enter Domain signatures.

Each exported operation has a focused verb-named source file. Shared nouns become directories.
Hand-authored source and test files remain below 600 lines.

## Persistence

Each durable service owns one logical database. Entity Framework Core is the .NET data-access
boundary. Operations use short-lived contexts and explicit transactions; a domain mutation and its
audit outbox entry commit together. Services communicate only through APIs, never shared tables.

SQLite configuration is supplied through a database adapter and deployed statefully. Any other
provider supplies its own configuration and migrations behind the same persistence operations.

Network calls never occur while a database transaction is held. Network and stream operations are
asynchronous and cancellation-aware. NativeAOT compatibility is a release requirement for every
dependency and code path.

## Verification

Tests exercise shipping processes through public APIs with real file-backed persistence and real
service dependencies. Mocks and in-memory replacements do not establish product behavior.

Required evidence covers:

- each public administrative and runtime operation;
- authentication, authorization, tenant fencing, validation, and concurrency;
- pagination, watch, streaming, cancellation, and restart behavior where supported;
- cross-service flows and dependency failures; and
- NativeAOT build and execution.

The specification defines behavior. Implementation details that do not affect interoperability,
security, ownership, or lifecycle stay out of it.
