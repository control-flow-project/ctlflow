---
title: edged
weight: 70
---

`edged` is the stateless public reverse-proxy boundary for one admitted HTTP
Package exposure. It owns no Tenant, route, Package, Placement, endpoint,
identity, policy, or durable record.

## Deployment model

Execd deploys one Edged sidecar for each admitted public HTTP exposure. The
application listener is loopback-private; the Kubernetes Service selects only
the Edged listener. Each sidecar receives one strict process-private binding
document containing:

```text
schema_version = 1
exact Tenant target and optional Workspace target
one loopback application port
```

The binding has no route table, upstream hostname, credential, policy,
Package selector, or Kubernetes coordinate. Changes replace the process.
Missing, malformed, unknown, or oversized fields fail startup and readiness.

The checked schema is
`services/edged/api/config/v1/binding.schema.json`.
The encoded binding is at most 64 KiB.

## HTTP contract

The checked `services/edged/api/http/v1/openapi.yaml` owns the complete public
surface. Root and nested paths admit exactly `GET`, `HEAD`, `POST`, `PUT`,
`PATCH`, `DELETE`, and `OPTIONS`. `CONNECT`, `TRACE`, and another method are
`405`. Health and readiness exist only on the separate probe listener.

Each admitted request:

1. enforces finite request-target, header, cookie, body, concurrency, and
   lifetime bounds;
2. removes all hop-by-hop and CtlFlow-protected headers;
3. extracts exactly one 32-byte Identityd Session credential from
   `__Host-ctlflow-session`;
4. calls `identityd.ExchangeSession` with that opaque credential and the
   binding's exact target;
5. forwards the unchanged method, origin-form path and query, admitted
   end-to-end headers, and bounded streaming body to the loopback application;
6. injects only `Authorization: Bearer <invocation JWT>` as trusted
   application identity; and
7. streams the bounded application response back after removing hop-by-hop
   headers and any attempt to set or clear the platform Session cookie.

Edged never parses the Session credential or invocation JWT and never names an
account or Actor. It forwards neither the platform cookie nor a caller
`Authorization`, `Proxy-Authorization`, `Forwarded`, `X-Forwarded-*`,
`Ctlflow-*`, `Host`, `Connection`, `TE`, `Trailer`, `Transfer-Encoding`, nor
`Upgrade` value as trusted downstream context. Non-platform application
cookies remain ordinary application data.

HTTP/1.1 streaming and server-sent events are supported with bounded
backpressure. WebSocket upgrade and public gRPC are not in the v1 contract.

## Trust and failure

```text
browser
  -> installation ingress
  -> Edged sidecar
       -> identityd.ExchangeSession
       -> loopback application
```

The ingress terminates public TLS. Edged calls Identityd over the production
private TLS and workload-authenticated gRPC path with a finite deadline and
W3C trace context. A cached identity or token is never reused; each request
performs one exchange. Edged has no Policyd or Auditd call.

Execd projects a short-lived Pod-bound Kubernetes token with the fixed
`ctlflow-edged` audience and the Identityd trust anchor into only the Edged
container. The colocated application receives neither projection. Identityd
accepts that purpose audience only for `ExchangeSession`; an installation
internal-audience token cannot call it.

| Condition | Public result |
| --- | --- |
| Missing, duplicate, or malformed Session cookie | `401` |
| Expired, revoked, unknown, or target-ineligible Session | `401` |
| Unsupported method | `405` with the fixed admitted methods |
| Request target, headers, cookies, or body exceed a bound | `414`, `431`, or `413` |
| Concurrency capacity exhausted | `429` with bounded `Retry-After` |
| Identityd unavailable or deadline exhausted before proxying | `503` |
| Loopback application unavailable | `502` |
| Application response exceeds its bound before response commitment | `502` |
| Application deadline exhausted | `504` |

After successful exchange, ordinary application status, body, media type, and
admitted end-to-end response headers pass through. Boundary errors use a
fixed plain-text body and disclose no Session, identity, target, dependency,
application, or stack detail.
If a streamed application response exceeds its bound after public response
commitment, Edged cancels both directions and closes the response; it cannot
replace already committed bytes with another status.

## Bounds

Request target is at most 16 KiB; request headers 32 KiB; cookies 8 KiB;
request and response bodies 64 MiB each; at most 256 requests are active per
process; and one request lives at most one hour. Buffering is finite and body
copying propagates disconnect, deadline, shutdown, and backpressure.

## Telemetry and verification

Stable operation names are `edged.http.<lower-method>`. Edged accepts W3C
trace context only for correlation and injects the resulting context into
Identityd and the application request. Baggage and caller-authored protected
context are discarded.

Telemetry is bounded and excludes paths, queries, headers, cookies, bodies,
credentials, tokens, Tenant and Workspace IDs, and raw errors. Collector
failure does not change behavior.

Canonical evidence uses the shipping listener, a real Identityd process, a
real loopback application fixture in the same Pod, and the strict binding
document. It proves the complete method/path inventory, Session exchange,
target fencing, protected-header replacement, cookie isolation, streaming,
all bounds and errors, cancellation, telemetry redaction, implementation
release gates, and Kubernetes packaging.
