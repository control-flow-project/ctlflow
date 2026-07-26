---
title: C# Runtime and Release
weight: 32
---

This page defines runtime integration and release gates for every C# service implementation. The
layering and data-access design remains in [C# Implementation](../).

## Authentication and telemetry

Service authenticates either an admitted kubeconfig client certificate for an operator operation
or a bound Kubernetes ServiceAccount token for an internal operation; a declared public route has
no authenticated caller. It then validates any permitted `identityd` invocation JWT and constructs
one typed request context. Server and operator-certificate handling remains in the Service
transport and authentication boundary; Domain and Db never receive certificate types.
Caller-asserted identity headers and alternate development authentication paths are forbidden.

A private gRPC contract uses one explicit HTTP/2-only address; a declared public HTTP contract uses
one explicit public address and exposes no undeclared gRPC endpoint. Every service uses one distinct
HTTP/1.1-only address for health and readiness. Routing constrains `/healthz` and `/readyz` to the
probe listener; no listener dispatches a protocol or operation it does not own.

C# instrumentation uses the OpenTelemetry .NET APIs with explicit `ActivitySource`, `Meter`, gRPC,
HTTP, and Entity Framework integration selected for NativeAOT compatibility. Runtime profiler
injection, reflection-discovered instrumentation, and a managed-only telemetry path are forbidden.

When C# renders a `Grpc.Core.StatusCode`, it deterministically converts the
runtime enum spelling to the canonical uppercase underscore status name
defined by the shared API. For example, `StatusCode.OK` is `OK` and
`StatusCode.DeadlineExceeded` is `DEADLINE_EXCEEDED`. Locale-sensitive casing,
`ToLowerInvariant`, concatenated Pascal case, and service-specific status
tables are forbidden.
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

Before restore or publication, the publisher cleans both the design-time `Debug` configuration and
the shipping `Release` configuration with build-server reuse disabled, then empties and recreates
its requested publication directory. Files from an earlier build or publication never participate
in compilation, Entity Framework generation, diagnostic collection, or the emitted artifact.

Canonical tests run that publisher in the digest-pinned shipping SDK environment and cache its
verified native output by the complete effective source fingerprint. Test images add only those
cached bytes to the digest-pinned shipping runtime base; they never republish on the host or compile
a second time while packaging the image.

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

For a durable service, Db references the Entity Framework build tasks and owns compiled-model and
query generation. Service also references the tasks so NativeAOT publication recurses into Db, but
disables its own model and query generation stages because Service owns no `DbContext`. A stateless
Service does not reference the tasks. Generated C# remains build output and is never hand-edited or
checked in.

For a durable service, SQLite is the required database provider. Its connection and file lifecycle
live under `Db/Sqlite/`. Every additional supported provider belongs in its own `Db/<Provider>/`
directory, uses the same Domain operations, and reaches the same Knex-owned logical schema and
canonical behavior. A provider does not change the gRPC contract or create another service
implementation. A stateless service has no provider directory.

## Review checklist

A C# service implementation is structurally complete when:

1. it has exactly Domain and Service, plus Db only when its owned contract is durable;
2. generated wire code comes only from the service-root protobuf contract and public HTTP routes
   come only from the owned checked HTTP contract;
3. wire types remain in Service and concrete provider concerns remain in Db;
4. Domain entities are mapped directly unless a named persistence escape hatch is justified;
5. every Entity Framework query uses a closed scalar projection, and mutations rehydrate and attach
   the same mapped Domain entity with its explicit original concurrency revision;
6. Db query/mutation operations and Domain decisions are semantic functions in verb-named files;
7. call sites use direct functions rather than use-case, command-handler, or repository ceremony;
8. all CtlFlow-owned operation APIs are awaitable and omit the `Async` suffix;
9. Knex remains the only migration authority when the service is durable;
10. every declared operator-certificate, workload-token, and invocation-token authentication path
    has one production realization without development bypasses;
11. generated model and query-interceptor output compiles as part of the gated NativeAOT
    publication when the service is durable;
12. the unchanged canonical suite passes against the NativeAOT process and real Collector; and
13. implementation-local tests contain only C#-specific release evidence.
