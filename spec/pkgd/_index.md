---
title: pkgd
weight: 55
---

`pkgd` is the authority for immutable Package declarations and installed
application intent. It does not execute workloads or own application data.

## Ownership

`pkgd` owns:

- Package identity, version, provenance, and artifact references;
- declared components, interfaces, dependencies, and exposures;
- one installed App identity and its desired Package generation; and
- the immutable declarations other kernel owners need to validate.

`execd` owns Placement and realization. `configd` owns configuration and
secrets. `identityd` owns attached accounts and delegated principals.
Application services own their own records and object authorization.

## Contract

Only methods declared in the service-owned versioned protobuf contract exist.
This page does not imply publication, build, install, upgrade, scale, revoke,
watch, transfer, or resolution methods.

Package and App records are CtlFlow domain records, not Kubernetes custom
resources. Kubernetes may store and run selected artifacts, but it is not an
alternate Package or App API.

## Invariants

- A Package version is immutable.
- Artifact references are digest-bound and never become mutable package state.
- An App pins one Package generation and one Placement.
- Package declarations do not grant identity, capability, network access, or
  dependency availability.
- Provider-specific behavior remains outside `pkgd`.
- A mutation requires an explicit versioned operation, a revision precondition
  where applicable, and direct audit through the approved audit contract.
