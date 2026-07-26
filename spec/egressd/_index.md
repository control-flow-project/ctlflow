---
title: egressd
weight: 75
---

`egressd` is the controlled external HTTP boundary for CtlFlow-managed
outbound traffic. Its policy is protocol-generic HTTP policy, never
provider-specific application logic.

## Ownership

`egressd` owns:

- external HTTP destination identity;
- the admitted caller, method, path, header, and body bounds for a destination;
- generic request and response rewrite policy; and
- the outbound allow or reject decision.

`configd` owns secret material. Runtime identity belongs to `identityd` and
`execd`. Provider-specific semantics belong to the provider or application.

## Contract

Only routes or methods declared in the service-owned versioned contracts
exist. This page does not imply destination CRUD, preview, watch, review,
secret-release, or generic administrative proxy methods.

An egress rule may generically:

- constrain origin, method, path, headers, body, redirect, and response bounds;
- add, remove, or replace headers and path segments;
- derive a consumer namespace from trusted runtime context; and
- request one purpose-bound secret projection from `configd`.

Rules do not name S3, PostgreSQL, Anthropic, OpenAI, or another provider
protocol. Those are configurations of generic HTTP behavior.

## Request boundary

Application code calls only the endpoint bound to its declared dependency.
The boundary authenticates the concrete runtime and ignores caller-supplied
upstream credentials whenever policy supplies authentication.

```text
App or Run -> bound egress endpoint -> egressd -> approved HTTP origin
```

## Invariants

- A caller cannot choose another destination, Tenant, Placement, consumer, or
  upstream credential.
- Credentials are purpose-bound and never returned to the caller.
- Rewrites use trusted runtime and binding facts, not protected request fields.
- Redirects and streaming remain inside the same admitted destination policy.
- Failure is bounded and fail-closed.
- Required decisions are directly audited through the approved audit contract;
  telemetry remains non-authoritative.
