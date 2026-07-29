---
title: edged API
description: Public application reverse-proxy contract and Session exchange flow.
weight: 90
---

`edged` is the public HTTP boundary for one admitted Package exposure. Its
checked contracts are:

- [`openapi.yaml`](https://github.com/control-flow-project/ctlflow/blob/main/services/edged/api/http/v1/openapi.yaml)
- [`binding.schema.json`](https://github.com/control-flow-project/ctlflow/blob/main/services/edged/api/config/v1/binding.schema.json)

See the [edged service specification](../../edged/) for header isolation,
streaming bounds, and failure behavior.

## Method and path inventory

One catch-all path includes `/` and every nested origin-form path:

| Method | Request body | Result |
| --- | --- | --- |
| `GET` | none | Proxied response or fixed boundary error |
| `HEAD` | none | Proxied response headers or fixed boundary error |
| `POST` | optional bounded stream | Proxied response or fixed boundary error |
| `PUT` | optional bounded stream | Proxied response or fixed boundary error |
| `PATCH` | optional bounded stream | Proxied response or fixed boundary error |
| `DELETE` | optional bounded stream | Proxied response or fixed boundary error |
| `OPTIONS` | optional bounded stream | Proxied response or fixed boundary error |

`CONNECT`, `TRACE`, and every other method return `405`. Edged has no
route-management, destination-management, preview, cache, or private inbound
gRPC API.

## Process binding

Execd creates one Edged sidecar for each admitted public HTTP exposure. The
sidecar receives one process-private document:

```json
{
  "schema_version": 1,
  "target": {
    "tenant_id": "northwind",
    "workspace_id": "atlas"
  },
  "upstream_port": 8080
}
```

`target` is either a Tenant or a Tenant plus Workspace. `upstream_port` is one
loopback application port. The binding contains no hostname, route table,
credential, policy, Package selector, or Kubernetes coordinate. The request
cannot override it.

## Request flow

```text
browser
  -> installation ingress
  -> Edged public listener
       |
       | opaque __Host-ctlflow-session credential
       v
     identityd.ExchangeSession(
       credential,
       binding Tenant,
       binding Workspace)
       |
       | short-lived invocation JWT
       v
     http://127.0.0.1:<binding upstream_port>
       Authorization: Bearer <invocation JWT>
  <- bounded application response
```

The ingress terminates public TLS. Edged uses its own projected, Pod-bound
workload token for the private Identityd call. The colocated application
receives neither that token nor the Identityd trust projection.

## Request example

```http
POST /api/messages?thread=general HTTP/1.1
Host: northwind.example.com
Cookie: __Host-ctlflow-session=<opaque>; theme=dark
Content-Type: application/json
Content-Length: 27

{"message":"Status update"}
```

After a successful Session exchange, the loopback application receives:

```http
POST /api/messages?thread=general HTTP/1.1
Host: 127.0.0.1:8080
Authorization: Bearer <short-lived invocation JWT>
Cookie: theme=dark
Content-Type: application/json
Content-Length: 27

{"message":"Status update"}
```

Edged removes the platform Session cookie and caller-supplied trusted-context
headers. It injects only the Identityd-issued `Authorization` value. Ordinary
non-platform application cookies remain application data.

Edged does not forward caller values for:

```text
Authorization
Proxy-Authorization
Forwarded
X-Forwarded-*
Ctlflow-*
Host
Connection
TE
Trailer
Transfer-Encoding
Upgrade
```

The response may carry the application's ordinary status, media type, body,
and admitted end-to-end headers. Edged removes hop-by-hop headers and blocks
an application attempt to set or clear the platform Session cookie.

## Authentication

Every request requires exactly one `__Host-ctlflow-session` value whose
unpadded base64url form decodes to 32 bytes. Edged does not parse that value.
It sends it only to `identityd.ExchangeSession` for the binding's exact
target.

There is no identity cache: each admitted request performs one Session
exchange. An expired, revoked, unknown, malformed, or target-ineligible
Session returns `401`.

## Streaming

HTTP/1.1 streaming and server-sent events are admitted with bounded
backpressure. WebSocket upgrade and public gRPC are not in the contract.
Client disconnect, deadline, shutdown, and body-copy cancellation propagate
in both directions.

## Boundary outcomes

| Condition | Public result |
| --- | --- |
| Missing, duplicate, malformed, expired, revoked, or ineligible Session | `401` |
| Unsupported method | `405` with the fixed admitted methods |
| Body too large | `413` |
| Request target too large | `414` |
| Concurrency exhausted | `429` with bounded `Retry-After` |
| Headers or cookies too large | `431` |
| Loopback application unavailable or invalid response | `502` |
| Identityd unavailable before proxying | `503` |
| Application deadline exceeded | `504` |

Boundary errors use one fixed non-disclosing plain-text representation.

## Bounds

| Resource | Bound |
| --- | ---: |
| Request target | 16 KiB |
| Request headers | 32 KiB |
| Cookies | 8 KiB |
| Request body | 64 MiB |
| Response body | 64 MiB |
| Active requests per process | 256 |
| Request lifetime | 1 hour |
