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

| Operation family | Purpose |
| --- | --- |
| Package | Publish, get, list, revoke, and resolve immutable declaration |
| Artifact | Register and resolve digest-addressed metadata and transfers |
| App | Install, update, suspend, resume, remove, and report realization |
| Contract | Resolve configuration, operation, provider, service, and exposure declarations |
| Exposure | Resolve one current App exposure inside an exact Tenant and optional Workspace |

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
