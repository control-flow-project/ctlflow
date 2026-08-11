---
title: Access
description: Immediate caller identity, invocation Actors, target fences, and capability decisions.
weight: 15
---

CtlFlow distinguishes infrastructure operators, Kubernetes workloads,
invocation Actors, attached accounts, and external callers. One identity class
never substitutes for another.

## Infrastructure operator

`ctlflow` uses a certificate-backed kubeconfig to request an authorized
port-forward from the Kubernetes API, then presents that same client
certificate end to end to the owning gRPC service.

```text
ctlflow -> Kubernetes API authorized tunnel -> owning service
   \______________________________________________/
               client certificate
```

The service validates the chain against the installation Kubernetes client CA
and admits an exact finite certificate subject. A request field or metadata
header cannot name or replace that subject.

There is no operator password database, reusable bootstrap bearer, active
Tenant login, or automatic conversion into an Identityd User.

## Workload identity

Each kernel or application workload has one Kubernetes ServiceAccount.
Kubernetes projects a bound, rotating token to the trusted process boundary.
The receiver validates issuer, signature, installation audience, expiry,
binding, namespace, and exact ServiceAccount subject.

```text
authorization: Bearer <bound workload token>
```

Reachability or a valid token does not admit an authority-bearing operation.
Every authority-bearing operation has an exact finite caller set.
`identityd.GetInvocationVerificationKeys` is the sole exception: any valid
installation-issued bound workload token may retrieve the bounded public
verification-key set. That bootstrap returns no identity fact, authority, or
decision.

## Invocation identity

An invocation JWT is a short-lived internal identity assertion used when a
call acts on behalf of a User or virtual principal. Its maximum lifetime is 60
seconds.

```text
iss             installation Identityd issuer
aud             installation internal audience
sub             attached or direct subject account
act.sub         distinct virtual Actor when present
tenant_id       target Tenant fence
workspace_id    optional narrower Workspace fence
session_id      browser-derived origin, mutually exclusive with run_id
run_id          finite-execution origin, mutually exclusive with session_id
iat, nbf, exp   bounded times
jti             unique token ID
```

The token contains no Role, capability, grant, endpoint, Kubernetes identity,
trace context, or permission snapshot. Nested Actor chains are rejected.
Signing material never leaves Identityd.

```text
ctlflow-invocation: Bearer <invocation JWT>
```

Every receiving service validates the token independently. A known public key
in a current bounded cache may remain usable during an Identityd outage;
unknown keys or expired caches fail closed.

Identityd creates invocations through exactly two paths:

```text
browser Session:
  edged -> identityd.ExchangeSession
  sub = Session human account
  session_id = Session origin

finite Run:
  execd -> identityd.IssueRunInvocation
  sub = direct or attached account
  act.sub = distinct virtual Actor when present
  run_id = Run origin
```

Execd authenticates as an exact admitted workload under the installation
internal audience. Each Edged sidecar authenticates with its Pod-bound
`ctlflow-edged` purpose audience, which Identityd accepts only for
`ExchangeSession`. Neither caller can provide an attached account, key,
issuer, invocation audience, permission, Role, or grant.
Identityd re-establishes current account standing and target fences before
signing.

Identityd validates the same token locally before returning principal or
direct-Group facts. The requested principal is constrained to the invocation
Actor or, only for virtual-principal Group expansion, that Actor's immutable
attached account. Request fields cannot select an unrelated principal.

## Capability path

A protected product operation requires:

```text
admitted immediate workload
AND valid invocation identity
AND target inside the invocation fence
AND policyd allow for the exact operation and path
AND owning-service Domain invariants
```

The owner constructs operation and path from validated domain values and
forwards the unchanged invocation JWT to Policyd. Policyd independently
validates it and loads current Identityd standing and Group facts.
A Workspace fence admits only that exact Workspace target; it does not admit
the parent Tenant or the Tenant's Workspace collection.

Membership proves standing only. It contains no Role or administrator flag.
A virtual Actor is allowed only when both the virtual principal and its one
immutable attached account have matching authority.

The policy target normally equals the protected resource target. Identityd
Workspace administration has one service-specific descendant form: for a
Tenant-scoped invocation, the policy target remains the Tenant while the
canonical resource path names one descendant Workspace. That form requires an
explicit Tenant-target grant and never inherits Workspace policy. A
Workspace-scoped invocation still uses its exact Workspace as the policy
target.

## Autonomous path

An explicitly admitted kernel lookup may omit the invocation JWT. It acts only
as its authenticated workload and receives only that operation's fixed
authority. It cannot be converted into an operator or capability call.

Autonomous, capability, and operator caller sets are disjoint.

## Internal call metadata

Every private call carries:

```text
authorization
ctlflow-invocation   when acting on behalf of an Actor
traceparent
tracestate           optional
```

Calls have finite deadlines and propagate cancellation. Protected identity
headers from an untrusted caller are stripped before a trusted boundary adds
validated context.

Egressd is the one private HTTP transport. It authenticates its exact bound
consumer with:

```text
Proxy-Authorization: Bearer <bound workload token>
```

That header is consumed and never forwarded. The ordinary `Authorization`
header is external-protocol data admitted only by the matched Egressd rule.

Edged consumes the platform Session cookie at the public boundary, exchanges
it through Identityd, and sends only standard
`Authorization: Bearer <invocation JWT>` to the loopback application.
Caller-supplied Authorization and CtlFlow-protected headers are removed first.

## Public boundary

`authd` is reserved for public authentication protocol traffic. `edged` is
reserved for general public application traffic. Every other kernel daemon is
private.

This boundary assignment does not imply any route. Public routes exist only in
their owner's checked versioned HTTP contract.

## Failure and evidence

Authentication, admission, target fencing, authorization, and dependency
failure are fail-closed. Invisible targets are not found.

Required security or mutation evidence uses the approved Auditd contract.
OpenTelemetry is bounded operational evidence and cannot replace audit.
