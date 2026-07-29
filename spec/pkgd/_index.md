---
title: pkgd
description: Immutable Package generations and installed App intent.
weight: 55
---

`pkgd` is the private authority for immutable Package declarations and
installed App intent. Its only domain surface is the unary gRPC contract in
`services/pkgd/api/proto/v1/pkgd.proto`.

**Wire reference:** [pkgd gRPC API](../apis/pkgd/)

## Ownership and records

Pkgd owns installation-global Package identity and immutable Package
generations. A generation contains:

```text
Package ID, generation, Semantic Version
source URI and source digest
components and digest-bound OCI artifacts
provided interfaces
open typed dependencies and bounded options
named exposures
declaration time
```

Each component names one OCI repository and `sha256` manifest digest. An
interface names its component, HTTP or gRPC protocol, contract ID, and port. A
dependency has a required stable human name, optional explicit ID, consuming
component, open type, and bounded consumer-declared options. An exposure names
one provided interface; it creates no route, listener, network grant, or
authorization.

Pkgd also owns globally unique App identity. An App contains:

```text
App ID
Global, Tenant, Workspace, or User scope
Placement ID
Package ID and desired Package generation
positive revision
creation and update times
```

App scope is a closed oneof:

| Scope | Stored facts |
| --- | --- |
| Global | No scope ID |
| Tenant | Tenant ID |
| Workspace | Tenant ID and Workspace ID |
| User | Tenant ID and human or service account principal ID |

These facts are Pkgd-owned immutable App intent, not duplicate authority for
the referenced records. Execd owns Placement identity and scope. Realization
requires the Placement's authoritative scope to equal the App scope exactly.
Pkgd neither reads the owning services' records nor treats scope facts as
proof of Tenant, Workspace, account, or Placement existence or state. The
capability path separately requires Policyd to establish current Actor
standing.

## Package and App rules

The first generation of a Package is `1`; every new generation is exactly the
preceding generation plus one. Version is unique within a Package ID.
Generations and their child declarations are immutable, ordered by generation,
and permanently retained.

App scope, Placement, Package ID, and creation facts are immutable. Desired
Package generation is the only mutable field, must exist under that Package
ID, and advances App revision once per actual change. App IDs are never
reused.

Canonical scalar bounds are:

| Field | Admitted value |
| --- | --- |
| Package ID | 1-128 lower-case ASCII characters; starts alphanumeric; remainder alphanumeric, `.`, `_`, or `-` |
| App, Tenant, Workspace, Placement, component, interface, present dependency, or exposure ID | 1-64 lower-case ASCII characters; starts alphanumeric; remainder alphanumeric, `_`, or `-` |
| Dependency name | Already NFC-normalized; 1-200 Unicode scalar values; no scalar with `General_Category` `Cc`, `Cf`, `Co`, `Cn`, `Zl`, or `Zp`; first and last scalars are not Unicode `White_Space` |
| User-scope account principal | Canonical `user:<local-id>` or `service:<local-id>`, at most 256 characters; local ID uses the Identityd principal grammar |
| Version | 1-128 ASCII characters; canonical Semantic Version 2.0.0 without leading `v` |
| Source URI | 1-2,048 visible ASCII characters; absolute `https` URI with DNS host and no user information, query, or fragment |
| Source or OCI manifest digest | `sha256:` followed by 64 lower-case hexadecimal characters |
| OCI repository | 1-255 lower-case ASCII characters in `<dns-host>[:<port>]/<path>` form, without scheme, tag, or digest |
| Contract ID | 1-128 lower-case ASCII characters in non-empty dot-separated declaration-ID segments |
| Dependency type | 1-128 lower-case ASCII characters in non-empty colon-separated segments matching `[a-z0-9][a-z0-9._-]*` |
| Interface port | 1-65,535 |
| Generation or revision | 1-9,223,372,036,854,775,807 |

An OCI host uses lower-case DNS labels, its optional canonical decimal port is
1-65,535, and each path segment matches
`[a-z0-9]+(?:[._-][a-z0-9]+)*`.

A dependency type is deliberately open. Values such as `postgresql`, `redis`,
`s3`, `persistent-filesystem`, and `service:notifications` are examples, not
an allowlist. Pkgd validates only the type grammar and generic options bounds.
A provisioning owner validates whether a type is supported and whether its
options are meaningful; Pkgd never selects a provider or
interprets provider semantics. Options are non-secret requirements, never
credentials, provider outputs, or Configd-owned material.

Every dependency requires `DependencyOptionsContent.canonical_json`: an
RFC 8259 JSON object in RFC 8785 canonical form, from 2 through 65,536 UTF-8
bytes, with the root object at depth 1 and maximum nesting depth 16. `{}`
represents no options. The Service and Db content boundaries own the bounded
content lease and canonical bytes. Public Domain signatures receive only a
typed options reference containing JSON format, byte length, and SHA-256
digest; raw bytes, JSON DOM values, dictionaries, and property bags never
enter Domain.

A Package has 1-64 components and at most 256 interfaces, 256 dependencies,
and 256 exposures. Component, interface, exposure, and every present
dependency ID are unique in their collection; dependency names are
case-sensitive and unique within their consuming component. The canonical
dependency key is component ID plus the admitted name's exact NFC UTF-8 bytes;
an optional dependency ID is an additional package-wide explicit reference.
No current declaration references a dependency or creates a binding.

Every interface and dependency component reference and every exposure
interface reference resolves inside the same generation, and an interface has
at most one exposure. The encoded declaration is at most 1 MiB. Collection
order is non-semantic. Responses order components, interfaces, and exposures
by ordinal ID and dependencies by canonical dependency key.

## Contract

Pkgd has exactly five operations:

| Operation | Purpose |
| --- | --- |
| `DeclarePackage` | Introduce one complete immutable Package generation |
| `GetPackage` | Recover one authoritative generation after declaration or restart |
| `CreateApp` | Introduce installed App intent |
| `GetApp` | Recover current App intent and its revision |
| `SetAppPackageGeneration` | Perform the sole App state transition |

Each operation is necessary to create, recover, or revise state owned by Pkgd.
There is no list workflow, so there is no list RPC, pagination, or cursor.
There is also no build, artifact transfer, deletion, uninstall, Placement
change, Package-ID change, scale, runtime lifecycle, watch, stream, route,
dependency provisioning, provider, identity, policy, or Kubernetes API.

`DeclarePackage` is idempotent by Package ID and generation. An identical
normalized retry returns the stored generation. Conflicting reuse of that key
or version is `ALREADY_EXISTS`; a non-next new generation is
`FAILED_PRECONDITION`.

`CreateApp` is idempotent by App ID. Pkgd retains the initial generation as a
creation fact. A retry with the same scope, Placement, Package ID, and initial
generation returns the current App; conflicting reuse is `ALREADY_EXISTS`.

`SetAppPackageGeneration` first returns `NOT_FOUND` for an absent App. When
current revision equals `expected_revision`, an already-current generation is
a no-op; otherwise an existing declared generation is committed at the next
revision. Current revision equal to expected revision plus one with the
requested generation already current is an identical retry. Every other
revision mismatch is `ABORTED`; an undeclared desired generation is
`NOT_FOUND`, and an actual change at maximum revision is
`FAILED_PRECONDITION`.

## Security and statuses

The caller matrix is exact:

| RPC | Operator | `SERVICE/svc_execd` | Configured product backend |
| --- | --- | --- | --- |
| `DeclarePackage` | Yes | No | No |
| `GetPackage` | Yes | Yes | No |
| `CreateApp` | Every scope | No | Tenant, Workspace, or User capability |
| `GetApp` | Every scope | Yes | Tenant, Workspace, or User capability |
| `SetAppPackageGeneration` | Every scope | No | Tenant, Workspace, or User capability |

The operator uses the admitted end-to-end kubeconfig client certificate.
Execd uses its bound Kubernetes ServiceAccount token without an invocation
JWT. A product backend uses a configured exact workload identity, a required
invocation JWT, and a Policyd allow. All paths use the production private TLS
listener. Caller sets are finite and disjoint; malformed configuration, an
empty required caller set, or overlap fails startup, and mixed or
caller-asserted identity is rejected.

Pkgd validates invocation keys independently through
`identityd.GetInvocationVerificationKeys`, applies the existing Tenant and
Workspace fence rules, and forwards the unchanged invocation to
`policyd.CheckAccess` as `SERVICE/svc_pkgd`. User scope additionally requires
its account principal to equal the validated invocation subject account.
Global Apps have no capability path. A request field never supplies identity
or authority. Every capability call, including a retry or no-op, repeats
invocation validation, scope fencing, and the Policyd decision.

The Pkgd-owned policy inputs are:

| Operation | Resource |
| --- | --- |
| `apps.create` | Scope collection path |
| `apps.read` | Exact App path |
| `apps.set_package_generation` | Exact App path |

Scope collection paths are `/apps`,
`/tenants/<tenant_id>/apps`,
`/tenants/<tenant_id>/workspaces/<workspace_id>/apps`, and
`/tenants/<tenant_id>/accounts/<account_principal_id>/apps`; the exact path
appends `/<app_id>`. The global path has no capability use and is never sent
to Policyd; Execd may still perform its exact autonomous read. Pkgd derives
every path and policy target from validated scope facts. Tenant and User scope
use the Tenant policy target; Workspace scope uses its exact Workspace target.

Transport authentication and caller-class admission precede body validation;
scope fencing and policy admission follow validated request or stored scope
facts. Calls use private TLS, finite deadlines, cancellation, and W3C trace
context.

| Status | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | A required scalar, enum, message, uniqueness rule, same-generation reference, or content value is absent, malformed, non-canonical, or outside its scalar bound |
| `RESOURCE_EXHAUSTED` | A collection, options document, nesting depth, or declaration-size bound is exceeded |
| `NOT_FOUND` | The exact Package generation or App does not exist, an App mutation names an undeclared generation, or a capability caller cannot establish the exact scoped App or current standing |
| `ALREADY_EXISTS` | A Package generation, Package version, or App ID conflicts with retained state |
| `FAILED_PRECONDITION` | A new Package generation is not the exact next generation, or an App revision cannot advance |
| `ABORTED` | App revision does not match and the request is not the immediately preceding identical retry |
| `UNAUTHENTICATED` | Required operator, workload, or invocation identity cannot be established |
| `PERMISSION_DENIED` | The caller is not admitted or Policyd returns deny |
| `UNAVAILABLE` | Persistence, stored state, invocation-key authority, Policyd, or obligatory Auditd delivery is unavailable or incompatible |
| `CANCELLED` / `DEADLINE_EXCEEDED` | The operation did not complete |

Raw database, OCI, certificate, stack, and dependency diagnostics never cross
the boundary.

## Persistence and readiness

Pkgd is durable. Its Knex-owned logical schema contains immutable Package
generation rows; same-generation component, interface, dependency,
options-content, and exposure rows; and App rows with a closed scope
discriminator, scope-appropriate Tenant, Workspace, or account facts,
immutable creation facts, and mutable desired generation, revision, and
update time. Checks admit no scope facts for Global, only Tenant ID for Tenant,
Tenant and Workspace IDs for Workspace, and Tenant plus account principal ID
for User.

Keys and foreign keys enforce same-generation references, version uniqueness,
one exposure per interface, and App references to retained Package
generations. Dependency options are stored with their format, length, digest,
and canonical bytes outside Domain entities. Domain code owns normalization,
generation sequencing, idempotency, immutability, revision decisions, and
audit intent.

Each declaration and App mutation commits atomically with optimistic
concurrency where applicable. Pkgd has no cross-service foreign key, history
table, cursor, mutable artifact record, audit outbox, queue, retry journal,
trigger, stored procedure, or SQL-resident domain behavior. No network call
occurs while a transaction is held.

Readiness requires the exact migration ledger and mapped schema plus valid
local server, operator-trust, workload-validation, invocation-key trust, and
Policyd/Auditd client custody. Health and readiness use the separate
probe-only listener.

## Audit and telemetry

Every actual mutation is delivered directly to
`auditd.RecordAuditBatch` after commit and before success:

| Operation | Required mutation facts |
| --- | --- |
| `declare_package` | Package ID and generation |
| `create_app` | Complete App scope, App, Placement, and Package IDs, initial generation, and revision `1` |
| `set_app_package_generation` | Complete App scope, App, Placement, and Package IDs, resulting generation, and revision |

The common envelope uses the retained declaration, creation, or resulting
update time as occurrence time and carries trace correlation and immediate
source `SERVICE/svc_pkgd`. Attribution is the admitted operator or, for a
capability mutation, the validated Actor and attached account plus the
immediate product-backend caller. Auditd owns the typed detail and partition
mapping; this Pkgd contract does not change either shared wire shape.

Replay identity is authenticated source plus `source_event_id`. The event ID
uses the existing `evt_<32-lower-case-hex>` shape: the hex is the first 16
bytes of SHA-256 over the UTF-8 bytes of
`pkgd/package/<package_id>/<generation>` or
`pkgd/app/<app_id>/<resulting_revision>`, with canonical decimal integers. A
later mutation never redelivers or repairs an earlier event.

Reads, identical operation retries, and no-op updates emit no audit event.
Audit failure is `UNAVAILABLE` and does not roll back committed state; a later
operation retry returns retained state without redelivering the failed event.
Pkgd retains no audit delivery state.
Audit contains no provenance, artifact, interface, dependency type or options,
exposure, request body, certificate, or token.

Every RPC, database operation, and Auditd call emits bounded OpenTelemetry
traces, metrics, and structured logs. Dimensions are limited to service,
operation, mutation/no-op class, and canonical outcome. Domain IDs, versions,
URIs, digests, repositories, ports, dependency types and options, bodies,
credentials, and audit payloads are excluded. Export is asynchronous and
bounded; Collector failure changes neither domain results nor readiness.

## Evidence

Canonical evidence covers:

- the exact five unary methods, wire fields, bounds, and excluded surfaces;
- immutable ordered Package generations, open dependency content boundaries,
  canonical ordering, retries, and conflicts;
- App creation in every closed scope, immutable references,
  desired-generation no-op/retry/change, revision conflict, and restart
  persistence;
- operator, Execd read, and scoped product-capability admission; invocation
  fencing, Policyd decisions, every documented status, direct audit facts,
  cancellation, schema/readiness failure, and redaction; and
- descriptor drift, common migration/schema checks, bounded Collector outage,
  and each implementation's release gates.
