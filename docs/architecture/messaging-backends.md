# Messaging backends

Messaging policy and messaging protocols have separate owners. Node, C# and Rust
implement the same boundaries, REST contract and SQLite schema. The React UI is
shared. Matrix is the implemented backend; Slack and Zulip are not implemented.

## Ownership

| Owner | Responsibility |
| --- | --- |
| Domain | Principals, ownership, grants, provenance, revisions, delegation and wake policy |
| Messaging authority port | Backend account lifecycle, authentication, room facts, capabilities, invitations and access application |
| Messaging client port | Normalized messages, history, feeds, membership changes, structured mentions, receipts and thinking notifications |
| Listener core | Acquisition, unread positions, admission, interruption, native delivery, recovery and observations |
| Backend adapter | Native validation, HTTP endpoints, event encoding, authority calculations, account parameters and client presentation |
| Composition root | Select and configure the backend; connect its authority, client and public HTTP integration |
| SQLite adapter | Persist neutral domain records and bounded opaque backend access parameters |

Domain, listener, generic contracts and UI do not parse Matrix IDs, event bodies,
power levels, registration stages or native routes. An adapter's numerical access
parameters and permissions are data, not generic policy. Generic code does not
interpret keys in those objects.

Matrix's server integration, Element configuration, registration fallback pages,
directory filtering, proxying, Conduit bootstrap and process ownership reside in
its adapter. Shared HTTP mechanics reside in the HTTP owner. Per-room operation
serialization resides in the runtime adapter, not the Matrix adapter.

## Current contracts

Account values have one shape:

```json
{"userId":"opaque identity","accessToken":"private token","native":{}}
```

Server configuration selects a backend with `messaging.type` and
`messaging.parameters`. Client settings use `backend.type` and
`backend.parameters`. Parameters are private or public according to their owner;
public discovery never returns the server's private backend credentials.

`GET /api/messaging-backend` provides the backend label, chat/signup URLs,
signup instructions and public connection configuration. The UI uses these
values instead of constructing native URLs. `POST /api/backend-authentication`
authenticates through the backend and requires the exact public request origin.
Ordinary management session creation and authorization remain shared.

Rooms, users and events use opaque identifiers. An event identity is scoped to
its room. Blocked-mention notice keys include the receiver, room and event;
publication and retention use that same composite identity. Native transaction
keys include the room and unambiguous field separators. Sender cooldown remains
receiver/sender-scoped across rooms, independently of event identity.
Normalized messages identify their semantic type, body, structured
mentions, edits, control status, attachments, subject and timestamp. Native
attributes remain opaque. Quoted names and edited/control messages do not become
interruption controls.

Native history keys distinguish private `shared`/`control` contexts from room
contexts, which use `room/` followed by the exact opaque room ID. This is internal
history naming, not a backend identifier format. Observations and routed messages
retain the actual room ID. A room named `control` cannot select private history.

The native public proxy uses the configured backend origin for HTTP/TLS transport
and retains the public Host header. It strips cookies, hop-by-hop and untrusted
forwarding headers. Native responses cannot set application cookies; redirects
are rejected. These rules do not replace authentication at the backend.

Room facts expose supported access modes, parameter fields, named capabilities
and an authority revision. The backend validates requested authority and applies
native membership/access operations. The domain rechecks identity, provenance,
revisions and delegation after native reads, before committing desired state.
Last-observed native access data does not grant authority and may remain recorded
after departure; membership and desired access are separate fields.

## Storage and replacement policy

One `00_initial.mjs` Knex migration creates the current schema directly. Tables,
columns and repository records use neutral names. Backend access objects are
bounded JSON objects; normalized ownership and permissions retain relational
constraints and indexes. Every implementation consumes the same SQLite file.

There are no old/new handlers, historical readers, conversion helpers, aliases
or fallback implementations. Before an explicit production declaration, existing
application data imposes no preservation requirement. A reset is an explicit
operator action, never automatic startup behavior. Credentials, source and native
histories are not deleted as part of schema replacement.

Verification includes protocol-independent fixtures with non-Matrix-shaped IDs
and access objects, real Matrix integration, shared external contract tests,
same-file SQLite checks and packaging/container checks. A passing fixture does
not certify an unimplemented backend.
