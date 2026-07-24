---
title: configd
weight: 60
---

`configd` owns validated product and workload configuration values, product and provider secret
custody, and selected dependency-provider configuration.

## Owns

| Record | Meaning |
| --- | --- |
| Configuration | Versioned non-secret values at one supported scope |
| Secret | Write-only material identity, policy, version, and custody binding |
| Secret version and projection | Append-only custody version and authorized runtime binding |
| Provider configuration | Selected provider and admitted options for one dependency use |
| Resolved generation | Complete immutable configuration projection for one consumer |

It serves `configurations`, `secrets`, and `providerconfigurations` in
`config.ctlflow.com/v1alpha1`.

## Activities

- Set, get, list, update, and delete non-secret configuration.
- Validate values against immutable Package or provider schemas from `pkgd`.
- Resolve inherited values for one Placement, App, Job, or dependency.
- Store secret material in Kubernetes Secrets under `configd` custody.
- Expose secret metadata, policy, version, and readiness without exposing material.
- Rotate, revoke, and delete secret versions.
- Materialize a secret into one authorized runtime slot.
- Release purpose-bound material to `egressd` for one admitted request.
- Accept controller- or provider-App-generated material only for an authenticated claim and
  declared secret output.
- Store exact provider selection and options for declared dependencies.
- Produce one complete immutable generation consumed atomically by `execd`.

## Configuration resolution

Configuration scopes use this deterministic precedence:

```text
 global < tenant < workspace < tenant-user < workspace-user < App-or-Job override
```

Only scopes applicable to the target Placement participate. A declaration identifies where each
field may be set and overridden. A lower scope cannot override an operator-controlled or
non-overrideable field. Placement constraints remain intersections enforced by `execd`; they are
not configuration values with last-writer precedence.

Resolution returns:

```text
consumer identity
target Placement
schema identity and version
ordered source revisions
complete typed ordinary values
secret references and exact versions
provider selections
resolved generation and digest
```

Missing required values, invalid provider options, name collisions, and unresolved secrets fail
before a generation is committed. `execd` never combines values from different generations.

## Secret custody

Secret material enters only through a named write-only `material` operation. The operation accepts
bytes over an authenticated bounded channel, stores them in a `configd`-owned Kubernetes Secret,
and returns only secret ID, version, digest commitment, and readiness.

For a workload:

```text
 execd -> configd authorize binding
       -> configd writes Placement-local Kubernetes Secret projection
       -> configd returns opaque binding and readiness
       -> execd references the binding only in the declared slot
```

Secret custody and authorized projections are `configd`'s only Kubernetes write authority. It
cannot create or mutate a namespace, workload, ServiceAccount, volume, policy, Service, or provider
resource. `execd` never receives the secret material.

For external HTTP:

```text
 egressd -> configd with destination, request, and secret purpose
          -> configd validates exact binding and releases material
          -> egressd applies it without returning it to the workload
```

There is no general read, export, debug, list-value, or reveal operation. Secret values never appear
in configuration responses, audit records, logs, errors, or Kubernetes names.

An admitted provider controller or provider App may submit a generated secret only under its exact
dependency claim and declared output slot. It receives a Secret reference, never a read capability;
provider status contains that reference only.

## Provider configuration

A provider configuration identifies an installed provider contract, exact provider Placement,
admitted options, and required secret references. It never contains outputs such as database host,
credential, or physical bucket. Those outputs are produced by the selected controller or provider
App and accepted into a consumer-specific `execd` dependency binding.

Operator configuration defines providers available to Placements. Tenant, Workspace, and user
configuration may select or narrow only providers admitted by inherited `execd` constraints.
`kernel:*` dependencies have no provider configuration; their owner and endpoint are fixed by the
kernel contract.

Kernel OpenTelemetry Collector endpoints, exporter configuration, and exporter credentials are
installation inputs rather than `configd` records. This avoids making `configd` depend on itself to
start, diagnose, or export telemetry. `execd` projects the admitted installation telemetry settings
into managed workloads.

Kernel bootstrap trust and credential material is also an installation input projected only into
the daemon that owns its use. This includes `identityd` invocation-signing material, Kubernetes
workload-token verification roots, ingress termination material, and Collector exporter custody.
It is never a product `Secret`, general configuration value, or application-readable projection.

## Direct operations

| Operation | Admitted caller | Purpose |
| --- | --- | --- |
| ValidateConfiguration | owning manager, `pkgd` | Validate one complete candidate against immutable declarations |
| ResolveConfiguration | `pkgd`, `execd`, admitted owner | Produce one complete immutable consumer generation |
| ResolveProviderSelection | `pkgd`, `execd` | Return one exact selected provider and validated options |
| PutSecretMaterial | owning manager | Commit the first version through a bounded write-only stream |
| RotateSecretMaterial | owning manager or admitted provider | Commit a new version without exposing either version |
| RevokeSecretVersion | owning manager | Irreversibly forbid one version from new materialization |
| SubmitDependencySecret | authenticated provider controller or App | Commit one generated secret output for an exact dependency claim |
| MaterializeWorkloadSecret | `execd` | Write one authorized Placement-local Kubernetes Secret projection |
| ReleaseEgressSecret | `egressd` | Release exact-purpose material for one admitted outbound exchange |
| EstablishConfigurationScope | `tenantd` | Establish one Tenant or Workspace configuration scope idempotently |
| SuspendConfigurationScope | `tenantd` | Block new generations and materializations in one scope |
| ResumeConfigurationScope | `tenantd` | Revalidate and restore one suspended scope |
| RetireConfigurationScope | `tenantd` | Irreversibly retire one scope generation and its projections |

### Configuration contract

`ValidateConfiguration` receives one consumer, immutable Package/schema digest, exact applicable
scope revisions, ordinary candidate values, Secret references, and provider selections. It returns
only typed field errors or a validated digest. Validation has no side effect and never materializes
a Secret.

`ResolveConfiguration` receives the exact consumer and target Placement plus the Package/schema
digest expected by the caller. It resolves only applicable scopes and commits one immutable
generation containing complete ordinary values, exact Secret versions, provider selections,
ordered source revisions, digest, and readiness. Repeating unchanged inputs returns the same
generation. Any changed source creates a new generation; an existing generation never mutates.

`ResolveProviderSelection` returns dependency declaration, provider contract/digest, selected
provider identity and Placement, admitted options, required Secret references, selection revision,
and readiness. It returns no provider outputs or credentials.

### Secret-material contract

Put, rotate, and provider submission begin with bounded metadata identifying Secret, expected
revision, declared content type and length, purpose, and idempotency key. Material then crosses one
authenticated finite stream directly into custody. The service computes a commitment while writing,
rejects length or digest mismatch, clears partial custody on failure, and returns only Secret ID,
version, commitment, and readiness. Material is never buffered into an administrative document or
echoed.

`SubmitDependencySecret` additionally requires claim ID, provider identity/generation, consumer,
declared output slot, and provider Placement. Those facts must match current `execd` and `pkgd`
contracts. The provider cannot select another Secret, consumer, slot, or version.

`MaterializeWorkloadSecret` receives exact Secret version, consumer, Placement, runtime generation,
and declared destination slot. After revalidating current owner and policy, `configd` writes one
opaque Placement-local projection and returns only binding ID, version, generation, and readiness.
The operation is idempotent and never returns native Secret name or material.

`ReleaseEgressSecret` receives destination, egress policy, dependency binding, runtime, Secret
version, declared authentication slot, and one request nonce supplied by `egressd`. It releases
material only over the authenticated response to that `egressd` request, marks it non-cacheable,
and records the exact purpose. It is not a general Secret read and cannot be called by a workload,
administrator, or provider.

### Scope lifecycle contract

Scope establishment, suspension, resumption, and retirement are keyed by `tenantd`
lifecycle-operation ID, generation, step, and idempotency identity. Establishment creates an empty
scope plus explicit initial configuration; suspension prevents new generations or materializations;
resumption revalidates sources; retirement rejects new use and removes projections only after
consumers are retired. Each response supplies the configuration-scope revision used by
`tenantd.AcknowledgeLifecycleStep`.

## Administrative resources

A Configuration has immutable scope, schema identity, and field identity; update replaces its
validated ordinary value at a new positive revision. A Secret has immutable owner scope, declared
purpose/schema, and custody policy; versions are append-only and expose metadata, commitment,
creation time, revocation, and readiness only. A Provider configuration has immutable consumer
dependency and stores one exact provider, provider Placement, validated options, and Secret
references. None may move to another owner or consumer.

Configuration and provider records support bounded exact-scope lists and watches. Secret lists
return metadata only. `material`, rotation, version revocation, and deletion are explicit
subresources. Deletion is rejected while a resolved generation, dependency claim, destination, or
retained projection references the record.

## Callers and dependencies

| Callee | Purpose |
| --- | --- |
| `tenantd` | Validate global/Tenant/Workspace/user configuration scope and lifecycle |
| `identityd` | Validate User scope and attached account standing |
| `pkgd` | Resolve immutable Package, configuration, Secret-slot, and provider declarations |
| `execd` | Validate Placement, consumer generation, dependency claim, runtime, and projection target |
| `auditd` | Deliver configuration and secret-custody evidence through the transactional outbox |

Only `configd` talks to the Kubernetes API for Secret custody/projection objects, using its narrow
resource authority. `egressd` receives exact-purpose material but no generic configuration
projection.

## Verification

Canonical evidence covers precedence at every applicable scope, forbidden widening, schema and
source revision drift, immutable generation reuse, provider selection and replacement, every
write-only stream boundary, length/digest failure and cleanup, rotation/revocation, concurrent
version writes, provider claim/slot spoofing, runtime projection confinement, exact-purpose egress
release, scope lifecycle/restart, cross-Tenant and cross-user invisibility, Kubernetes Secret
write-authority limits, dependency outage, cancellation, telemetry redaction, and transactional
audit delivery. Evidence scans every response, error, log, trace, metric, and audit envelope for
submitted material.

## Invariants

- Every value is validated against one immutable declaration before commit.
- A resolved generation is immutable and complete.
- Secret material has no general read path.
- Secret release is exact-purpose, exact-version, authenticated, and audited.
- Provider configuration selects one provider explicitly and never records provider outputs.
- Configuration cannot widen Placement constraints or authorization.
- Kernel bootstrap trust, signing, ingress, and telemetry custody do not depend on `configd`.
- `configd` owns no Package schema, workload, dependency binding, route, or application data.
