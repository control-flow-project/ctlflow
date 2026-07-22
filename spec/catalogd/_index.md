---
title: catalogd
weight: 45
---

`catalogd` owns the infrastructure-wide definitions that Tenants instantiate.

## Owns

| Record | Meaning |
| --- | --- |
| Package | Immutable versioned App or Job contract |
| Resource profile | Immutable operator-approved execution sizing |

It serves `catalog.ctlflow.com/v1alpha1` as `packages` and `resourceprofiles`. Tenant principals may
read the catalog; only infrastructure operators may publish it.

## Package contract

A Package has a unique `name@version`, a kind (`app` or `job`), and digest-pinned OCI images.

- An App package declares one or more components. A continuous component remains available; a
  completion component runs during a declared App lifecycle phase.
- A Job package declares exactly one finite Run component.

Components express requirements rather than Kubernetes kinds. They may declare configuration,
ports, health checks, resource profile, persistent-data and secret slots, provided or required
service endpoints, operation capabilities, and published or accepted Event types.
Component keys are stable across versions intended as upgrades of the same App Package.

Packages may define application operation tokens and Event schemas. Tokens are opaque to CtlFlow
but globally unambiguous; consumers reference a definition rather than redefining it. Configuration
and Event payloads use bounded JSON Schema 2020-12 documents with no remote references.

## Responsibilities

- Validate the complete Package before publication.
- Require digest-pinned images.
- Preserve Package and profile immutability.
- Revoke a Package version through a terminal status without changing its published body.
- Track whether `execd` has stopped every execution affected by a revocation.
- Resolve Packages, profiles, operation declarations, and Event declarations for other services.
- Reject native Kubernetes names and provider credentials in Package documents.

Published Package and profile bodies cannot be updated or deleted. A changed contract is a new
Package version; changed sizing is a new profile. A revoked Package remains resolvable for evidence
but cannot be instantiated or executed. This keeps historical Apps and Runs resolvable without
distributed reverse-reference deletion.

`catalogd` does not build images, install Apps, create Jobs, or interpret application tokens.

## Invariants

- One `name@version` identifies one canonical Package body for the life of the infrastructure.
- Revocation is terminal and never changes the canonical Package body.
- Every image reference includes a content digest.
- Every referenced profile and declaration exists at publication time.
- An App Package has at least one component; a Job Package has exactly one finite component.
- Package documents contain no Tenant, Context, namespace, ServiceAccount, Secret, or native object
  identity.
