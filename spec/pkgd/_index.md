---
title: pkgd
weight: 55
---

`pkgd` owns immutable software contracts and the intent to install App Packages at Placements.

## Owns

| Record | Meaning |
| --- | --- |
| Package | Immutable versioned App or Job contract |
| Artifact | Digest-addressed Package source, image, or UI artifact metadata |
| App | One App Package installed at one Placement |
| App generation | Immutable desired App state pinned to one Package version |
| Service contract | Versioned compatibility identity provided or required by components |
| Exposure | Package-declared product or external endpoint |
| Operation declaration | Application operation token and owning components |
| Provider contract | Dependency type, options, outputs, and provider realization contract |

It serves `packages`, `apps`, and read-only projections of `servicecontracts` and `exposures` in
`packages.ctlflow.com/v1alpha1`.

## Package scope and trust

A Package has immutable ownership at global, Tenant, Workspace, or user scope. It carries:

- opaque Package ID and immutable version;
- bounded display metadata;
- provenance and trust classification;
- digest-pinned OCI and UI artifacts;
- App components or one finite Job component;
- configuration and secret declarations;
- persistent filesystem slots;
- named dependency declarations;
- provided service contracts and exposures;
- application operation declarations; and
- resource requirements subject to Placement constraints.

Operator and distro Packages may be admitted at shared Placements by policy. Tenant, Workspace, and
user Packages remain fenced to their owner and are untrusted unless an explicit trust policy says
otherwise. Package authorship never grants execution authority.

## Dependency declaration

```yaml
dependencies:
  - name: database
    type: postgresql
    version: ">=16"
    options:
      extensions: [pgvector]
    env:
      PGHOST: CHAT_DB_HOST

  - name: notifications
    type: service:notifications

  - name: policy
    type: kernel:policy

components:
  - key: api
    uses: [database, notifications, policy]
```

Provider dependency type keys are open contracts. `pkgd` validates common declaration fields and
the selected provider's immutable option/output schema. It does not interpret PostgreSQL, Redis,
S3, model provider, or another external domain.

A provided peer endpoint declares its service contract, compatible version, HTTP/gRPC/TCP protocol,
streaming behavior, port, health relationship, exposure class, and delegation mode. It never
contains a resolved URL or Kubernetes name.

An external exposure additionally declares one fixed route root, finite method/protocol limits,
coarse operation token, and exactly one authentication class: `session`,
`application-authenticated`, or `anonymous`. Application-authenticated exposures enumerate the
specific credential headers or query fields delivered as application data; they cannot mark a
CtlFlow protected identity or routing field as application data.

`kernel:<contract>` names a fixed versioned CtlFlow contract. It has no provider options or
selection. `pkgd` validates that the Package declares only admitted kernel operations.

## App lifecycle

Creating an App:

1. validates Package visibility, trust, and target Placement;
2. validates that the attached account is admitted for the target Placement and asks `identityd`
   for component virtual principals;
3. stores the initial Package version and immutable Placement and account references;
4. asks `configd` to validate complete configuration and provider selection;
5. asks `execd` to admit and realize components and dependencies; and
6. marks the App active only when every required component and binding is ready.

The Placement and attached account are immutable. An explicit compatible upgrade creates a new App
generation pinned to an admitted newer Package version while preserving prior generations for
status and evidence. An upgrade that would orphan a principal, dependency, persistent slot, or
exposure is rejected.

Removal first blocks new exposure and execution, then asks `execd` to retire realization. Persistent
data follows the App's explicit retain or delete policy.

## Build flow

Generated or uploaded source is bounded metadata plus an artifact reference. `pkgd` validates its
build declaration and asks `execd` to run the selected trusted build Package in an isolated
Placement. Successful output is pushed to the configured OCI registry and recorded by digest before
Package publication.

Build implementation, compiler, and registry are dependencies. `pkgd` owns Package truth, not a
general-purpose build machine.

Package revocation is terminal. After committing revocation, `pkgd` asks `execd` to stop every App
generation, Job, and Run attempt pinned to that version. Their records and evidence remain; no
replacement Package is selected automatically.

## Direct operations

| Operation | Admitted caller | Purpose |
| --- | --- | --- |
| PublishPackage | operator or admitted product manager | Validate and commit one immutable Package version |
| RevokePackage | operator or admitted owner | Irreversibly block new use of one Package version |
| ResolvePackage | kernel owner | Return one immutable executable declaration and publication state |
| AuthorizeArtifactTransfer | `edged`, build flow, admitted owner | Return one short-lived purpose-bound transfer for an exact digest |
| InstallApp | operator or admitted product manager | Create one App at one Placement |
| UpgradeApp | operator or admitted App manager | Create one compatible App generation |
| SetAppScale | operator or admitted App manager | Set admitted component scale for a current generation |
| SuspendApp | operator or admitted App manager | Block exposure and new realization for one App |
| ResumeApp | operator or admitted App manager | Revalidate and restore one suspended App |
| RemoveApp | operator or admitted App manager | Irreversibly retire one App and apply persistent-slot policy |
| ResolveAppGeneration | `execd`, `edged`, kernel owner | Return immutable current App-component intent |
| ReportAppRealization | `execd` | Commit bounded observed component and binding status |
| ReconcileBaselineApps | `tenantd` | Idempotently install the explicitly requested baseline set |
| ResolveConfigurationSchema | `configd` | Return the immutable schema for one Package consumer |
| ResolveProviderContract | `configd`, `execd` | Return one immutable dependency provider contract |
| ResolveServiceContract | `execd` | Return one provided or required service compatibility declaration |
| ResolveOperationCeiling | `policyd` | Return operations declared for one exact Package component |
| ResolveExposure | `edged` | Resolve one exact current exposure inside an established Tenant/Workspace fence |

### Package contract

`PublishPackage` receives one canonical declaration plus digest-addressed artifact metadata. Its
immutable publication key is owner, Package name, and version. Repeating the same key and canonical
body returns the same Package; a different body is `ALREADY_EXISTS`. Publication validates every
component, dependency, configuration/secret field, persistent slot, service contract, operation,
exposure, resource bound, artifact digest, provenance, and trust classification before committing
any record.

`ResolvePackage` returns the canonical declaration, content digest, provenance, trust, publication
state, and revision. It never returns artifact bytes, build credentials, resolved provider output,
configuration values, endpoints, or Kubernetes realization. Revoked Packages remain resolvable but
cannot admit publication-dependent work.

An artifact transfer is bound to one Package artifact digest, caller, purpose (`upload`,
`download`, `build-input`, `build-output`, or `ui-serve`), method, byte bound, and short expiry. A
transfer cannot address another digest or be converted into registry-wide access.

### App contract

`InstallApp` receives one visible App Package version, exact Placement, existing attached account,
bounded App display metadata, Package-declared configuration input, exact provider selections, and
an idempotency key. Placement and account become immutable. `pkgd` commits the pending App before
asking `identityd`, `configd`, or `execd` to advance its generation.

`UpgradeApp` receives the App, expected revision, newer Package version, and revised declared
configuration/provider input. Compatibility requires every retained component principal,
persistent slot, dependency, service contract, and exposure to have an explicit compatible
successor. It creates a generation; it does not mutate the prior Package body.

Scale changes address one scalable component and remain inside both Package and Placement bounds.
Suspension blocks exposure and new realization without changing identity or state. Removal is
irreversible, retires exposure first, drains execution, applies each slot's declared retain/delete
policy, and retains the App tombstone and generation evidence.

`ResolveAppGeneration` returns App, Placement, attached account, component virtual principals,
Package digest, configuration generation, dependency declarations, persistent slots, desired
scale/lifecycle, and generation revision. `ReportAppRealization` accepts only the current generation
from `execd`, with bounded component/binding readiness and stable reasons. It cannot change desired
intent. The App becomes active only when every required item is ready.

### Contract and exposure results

Schema and contract resolution uses exact Package ID, version, declaration identity, and expected
digest. Results are immutable bounded declarations and a revision; there is no "latest compatible"
fallback. Operation ceilings list only tokens owned by the exact component.

`ResolveExposure` receives resolved Tenant and optional Workspace, external method, and canonical
remaining path. It matches one installed exposure's unambiguous fixed route root and returns
exposure ID, exact App, generation, component, endpoint declaration, target Placement,
authentication class, operation token, delegation mode, streaming bounds, unmatched application
path, UI artifact digest when applicable, and expiry no later than 60 seconds. An optional cached
exposure ID and generation may be supplied only as a revalidation precondition; it cannot select a
different route. The result contains no ready network address; `edged` resolves that separately
through `execd`.

## Administrative resources

A Package resource is immutable after publication except for terminal revocation status. Artifacts,
service contracts, and exposures are read-only projections keyed by their Package version. An App
resource contains immutable Package kind, Placement, attached account, and creation identity;
mutable desired generation, scale, and lifecycle use explicit operations and positive revision
preconditions. Lists and watches support exact owner, Package, Placement, lifecycle, and App
selectors only and follow the common bounded contract.

## Callers and dependencies

| Callee | Purpose |
| --- | --- |
| `tenantd` | Validate Package/App owner Tenant or Workspace lifecycle |
| `identityd` | Validate attached account and create or retire component virtual principals |
| `configd` | Validate complete configuration and exact provider selections |
| `execd` | Run isolated builds and realize, drain, or retire App generations |
| `auditd` | Deliver publication, App lifecycle, and exposure evidence through the transactional outbox |

`edged`, `policyd`, `configd`, and `execd` receive only their exact immutable projections. `pkgd`
never asks them to infer Package content.

## Verification

Canonical evidence covers canonical publication and conflict, every declaration and artifact
validation, revocation, ownership/visibility, bounded lists and watches, transfer confinement,
App installation and restart between lifecycle steps, attached-account and Placement failure,
compatible and incompatible upgrade, scaling bounds, suspension/resumption/removal, persistent-slot
policy, baseline idempotency, stale realization reports, exact contract/exposure resolution,
cross-Tenant invisibility, dependency outage, cancellation, concurrency, telemetry redaction, and
transactional audit delivery.

## Invariants

- One immutable publication key identifies one canonical Package body.
- Every executable and UI artifact is content-addressed.
- Package documents contain no credentials, resolved endpoints, physical namespaces, or native
  workload names.
- Every App has one immutable Placement and attached account; each App generation pins one
  immutable Package version.
- A revoked Package remains resolvable for evidence and admits no new build, App, Job, or Run.
- Service providers and consumers resolve through exact contract versions.
- `pkgd` stores no configuration value, secret material, Run, runtime status, or Kubernetes object.
