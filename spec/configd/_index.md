---
title: configd
weight: 60
---

`configd` is the authority for non-secret configuration and secret custody.
Those data classes share an owner but never share a read surface.

## Ownership

`configd` owns:

- scoped non-secret configuration;
- secret identity, versions, custody, and authorized projections;
- references to provider configuration; and
- the immutable resolved configuration supplied to an admitted consumer.

It does not own Tenants, identities, Packages, Placements, workloads,
dependency lifecycle, or provider-specific reconciliation.

## Contract

Only methods declared in the service-owned versioned protobuf contract exist.
This page does not imply generic key/value CRUD, secret reads, watches,
provider catalogs, materialization workers, or Kubernetes-resource APIs.

Secret material may enter only through a purpose-bound write operation and
leave only through a purpose-bound projection operation once those operations
are explicitly present in the contract. A general read-secret operation is
forbidden.

## Kubernetes boundary

`configd` may be the narrow owner that writes Kubernetes Secret custody and
consumer projections. That is an implementation responsibility, not a CtlFlow
CRD or second domain API. No other kernel service may read `configd` storage or
secret material directly.

## Invariants

- Configuration and secret identifiers are scoped and immutable.
- Secret values never appear in domain responses, logs, telemetry, or audit
  payloads.
- A projection is bound to one admitted consumer and cannot be reused by
  another runtime.
- Provider-specific schemas and behavior remain owned by the provider.
- Mutations are explicit and directly audited through the approved audit
  contract.
