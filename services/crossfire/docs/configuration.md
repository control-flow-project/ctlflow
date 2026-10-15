# Instance configuration

Initialization creates private `config.json` and `bootstrap.json` under the
selected state directory. Restart the server to apply a configuration-file
change. Do not put these files in source control or expose them through nginx.

## Server fields

| Field | Meaning |
| --- | --- |
| `instance` | Lowercase instance identifier, at most 40 characters |
| `serverName` | Native Matrix server name; not a display label |
| `publicOrigin` | Exact application origin |
| `contentOrigin` | Exact separate report origin/hostname |
| `matrixOrigin` | Private native homeserver endpoint |
| `administrator` | Initial human Matrix ID on this server |
| `jwtSecret`, `registrationSecret` | Private native integration credentials |
| `publicationBudget` | Optional finite report reservations and upload concurrency |
| `loggingRetentionDays` | Positive exact integer; omitted means seven days |
| `trustedProxyAddresses` | Up to 32 distinct literal immediate-peer IP addresses; omitted means none |

Unknown fields and invalid origins fail startup. HTTPS is required for public
origins; explicit loopback HTTP is for local use. Content must not share the main
or Matrix HTTPS hostname. Changing a label cannot confer authority.

## Trusted ingress and request quotas

Public login, signup, invitation-claim and enrollment mutations use:

| Budget | Bound |
| --- | --- |
| One client | 120 admitted requests per 60-second window |
| Instance aggregate | 4096 admitted requests per 60-second window |
| Retained client buckets | 4096; expired entries are removed |
| Refusal | HTTP 429 and `Retry-After: 60` |

Failed input validation still counts. A client already over its quota cannot
consume more of the aggregate admission budget. These are HTTP anti-abuse
limits, not model tokens, provider billing or authenticated chat quotas.
Counters are process-local and reset at server restart.

Without configured proxies, the connection peer is the client key. Arbitrary
`Forwarded` or `X-Forwarded-For` headers do not establish client identity.

For an explicitly trusted immediate peer, exactly one `X-Forwarded-For`
header containing one literal IP is required. Missing, duplicate, chained,
scoped or malformed values are rejected. IPv4-mapped IPv6 identities normalize
to the same IPv4 bucket. Trust applies only to quota attribution, never to
authentication, roles, room permissions or origin checks.

Configure the actual peer address observed at the application boundary. A
container's address may differ from the host's loopback address. Do not assume
that every loopback/container/private-network address is trusted. Do not list
a public network, use a CIDR, trust every proxy hop or copy an attacker-controlled
header. With multiple ingress instances, list each exact immediate peer and
require all of them to overwrite the client header.

Example operator-owned nginx application location:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header Forwarded "";
    proxy_set_header X-Forwarded-Host "";
    proxy_read_timeout 130s;
}
```

Use `$remote_addr`, not `$proxy_add_x_forwarded_for`, at this trusted boundary.
If another proxy precedes nginx, establish its authenticated/trusted client
identity there before forwarding one address. Misconfigured proxy trust can
collapse users into one bucket or permit spoofing; it is not fixed by raising
the per-client quota.

## Administrator policy

Management Settings stores revision-checked instance policy in SQLite:

- Signup: invitation-only by default, or explicitly open.
- Invitation issuers: administrators by default, optionally members too.
- Member-owned agents: default ten; instance capacity: default one hundred.
- Enrollment capacity/expiry and native reconciliation cadence.
- `maxMessageBytes`: default 65536 UTF-8 bytes, range 4096–4194304.
- `fleetIdleTimeoutSeconds`: default 1800, range 0–604800; zero disables sleep.
- Additional agent instructions and reset to the shipped default.

Large incoming messages use private files, not truncation. Idle sleep stops
native engines, not the shared listener. Explicit Stop prevents message-driven
restart. Administrator status does not authorize another owner's native decisions
or expose every private Matrix room.

## Native settings

Fleet role definitions and per-instance overrides own model, effort and native
permission settings. Management shows configured/effective observations.
It does not configure host process arguments or take over the setup assistant.

- [Fleet configuration](../../fleet/docs/configuration.md)
- [Publication budgets](publications.md)
- [Logging families](logging.md)
