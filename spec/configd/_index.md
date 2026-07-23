---
title: configd
weight: 60
---

`configd` owns validated configuration values, secret custody, and selected dependency-provider
configuration.

## Owns

| Record | Meaning |
| --- | --- |
| Configuration | Versioned non-secret values at one supported scope |
| Secret | Write-only material identity, policy, version, and custody binding |
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

## Direct operations

| Operation family | Purpose |
| --- | --- |
| Validate | Validate values against one immutable schema |
| Resolve | Produce one complete configuration generation |
| Secret material | Put, rotate, revoke, and purpose-materialize write-only material |
| Provider | Resolve exact selected provider and admitted options |
| Scope lifecycle | Establish, suspend, resume, and retire configuration scope |

## Invariants

- Every value is validated against one immutable declaration before commit.
- A resolved generation is immutable and complete.
- Secret material has no general read path.
- Secret release is exact-purpose, exact-version, authenticated, and audited.
- Provider configuration selects one provider explicitly and never records provider outputs.
- Configuration cannot widen Placement constraints or authorization.
- `configd` owns no Package schema, workload, dependency binding, route, or application data.
