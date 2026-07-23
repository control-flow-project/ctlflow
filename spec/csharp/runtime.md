---
title: C# Runtime and Release
weight: 32
---

This page defines runtime integration and release gates for every C# service implementation. The
layering and data-access design remains in [C# Implementation](../).

## Authentication and telemetry

Service validates the bound Kubernetes ServiceAccount token before invoking a Domain function. It
then validates the optional `identityd` invocation JWT and constructs one typed request context.
Certificate parsing, private daemon certificate configuration, caller-asserted identity headers,
and an alternate development authentication path are forbidden.

Kestrel binds one explicit HTTP/2-only address for direct gRPC and one distinct HTTP/1.1-only
address for health and readiness. Routing constrains `/healthz` and `/readyz` to the probe listener;
the gRPC listener cannot silently downgrade to HTTP/1.1, and the probe listener cannot dispatch a
gRPC operation.

C# instrumentation uses the OpenTelemetry .NET APIs with explicit `ActivitySource`, `Meter`, gRPC,
HTTP, and Entity Framework integration selected for NativeAOT compatibility. Runtime profiler
injection, reflection-discovered instrumentation, and a managed-only telemetry path are forbidden.
The shipping native process exports bounded OTLP and preserves W3C `traceparent` and `tracestate`.

OpenTelemetry package versions are pinned centrally. Native publication and integration tests
exercise startup, propagation, redaction, export, and Collector outage through the actual shipping
binary. An instrumentation package that cannot pass NativeAOT is not used.

## NativeAOT profile

Every shipping C# Service project publishes as NativeAOT. Native publication is a release gate, not
an optional optimization. A package may be used only when its required paths are compatible with
trimming and NativeAOT. Runtime code generation, reflection-based serializers, managed fallback
artifacts, and separate non-native behavior paths are forbidden.

The repository owns one command-line NativeAOT publisher used by local verification, canonical
tests, and release automation. It captures managed compilation, Entity Framework generation,
trimmer, and native compiler diagnostics. Each C# implementation checks in one diagnostic manifest
containing the exact normalized fingerprint and multiplicity of every upstream diagnostic that
cannot be removed under the pinned SDK and package set. A fingerprint contains the diagnostic code,
owning project, normalized source identity, and complete message. Normalization may replace only
machine-specific repository, package-cache, generated-output, and publication roots; it cannot
discard a diagnostic code, source identity, message, or multiplicity.

Publication fails for a missing, additional, or changed fingerprint. Broad `NoWarn`, source or
MSBuild suppression attributes, wildcard entries, accept-any matching, and a warning-tolerant
release command are forbidden. Updating the pinned toolchain or changing generated queries requires
an explicit manifest review. The manifest admits a known toolchain diagnostic only; it never proves
the affected runtime path, which must still execute through canonical and implementation-local
native tests.

Use generated protobuf bindings, source-generated closed-world metadata where needed, bounded
asynchronous I/O, pooled long-lived clients and context factories, and finite concurrency. Native
tests exercise the actual published binary and real database provider rather than a managed test
host.

Db references the Entity Framework build tasks and owns compiled-model and query generation.
Service also references the tasks so NativeAOT publication recurses into Db, but disables its own
model and query generation stages because Service owns no `DbContext`. Generated C# remains build
output and is never hand-edited or checked in.

SQLite is the required database provider. Its connection and file lifecycle live under
`Db/Sqlite/`. Every additional supported provider belongs in its own `Db/<Provider>/` directory,
uses the same Domain operations, and reaches the same Knex-owned logical schema and canonical
behavior. A provider does not change the gRPC contract or create another service implementation.

## Review checklist

A C# service implementation is structurally complete when:

1. it has exactly the Domain, Db, and Service production projects;
2. its generated wire code comes only from the service-root protobuf contract;
3. wire types remain in Service and concrete provider concerns remain in Db;
4. Domain entities are mapped directly unless a named persistence escape hatch is justified;
5. Db query/mutation operations and Domain decisions are semantic functions in verb-named files;
6. call sites use direct functions rather than use-case, command-handler, or repository ceremony;
7. all CtlFlow-owned operation APIs are awaitable and omit the `Async` suffix;
8. Knex remains the only migration authority;
9. workload and invocation authentication have one production path without certificates or
   development bypasses;
10. the unchanged canonical suite passes against the NativeAOT process and real Collector; and
11. implementation-local tests contain only C#-specific release evidence.
