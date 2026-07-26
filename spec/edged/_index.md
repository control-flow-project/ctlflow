---
title: edged
weight: 70
---

`edged` is the public reverse-proxy boundary for application and product
traffic. It owns no Tenant, route, Package, Placement, endpoint, identity, or
policy record.

## Boundary

`edged` is responsible for:

- receiving admitted external HTTP traffic;
- stripping caller-supplied protected context;
- deriving trusted downstream context from authenticated owner facts;
- resolving one declared target through owning services;
- proxying the request with bounded buffering and streaming; and
- mapping private failures to non-disclosing public responses.

Routes are derived from current owner records. There is no manually managed
route table.

For an authenticated browser request, Edged sends the opaque cookie credential
and resolved exact target to `identityd.ExchangeSession`. It forwards only the
returned short-lived invocation JWT to the private target. Edged never parses,
signs, stores, or forwards the browser credential.

## Contract

Only routes declared in an `edged`-owned versioned HTTP contract and methods
declared in an `edged`-owned protobuf contract exist. This page does not imply
preview, cache inspection, cache eviction, drain, undrain, route mutation, or
administrative HTTP APIs.

Caches are finite, local, rebuildable projections. Cache behavior is process
operation, not a domain record or caller-visible management surface.

## Trust boundary

```text
external request -> edged -> resolved private target
```

Every owner lookup is independently authenticated and bounded by deadline and
cancellation. `edged` cannot treat a cached identity, route, or endpoint as
authority for a different Tenant or Workspace.

The downstream service receives only context established from validated
transport and owner facts. Public cookies, external bearer tokens, and
caller-authored identity headers are never forwarded as trusted kernel
identity.

## Invariants

- `edged` is the only public kernel boundary for general application traffic.
- It never writes another service's domain state.
- It never starts a workload except through an explicitly approved owner
  operation.
- A dependency outage fails closed and never selects a substitute target.
- Telemetry is bounded and redacted; required security evidence uses the
  approved audit contract.
