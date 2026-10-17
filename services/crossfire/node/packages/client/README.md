# crossfire HTTP client

Private browser-safe transport for the current wire contracts.

| Export | Responsibility |
| --- | --- |
| client | Typed validated REST requests and responses |
| binary-request | Bounded binary upload transport |
| matrix-login | Native Matrix password login over HTTP |

Dependencies are kernel and contracts, not server composition, storage, native
runtime or Node platform APIs.
React, coordination adapters and operator tools consume declared exports.

Cookie/CSRF and bearer authentication are mutually exclusive.
Requests use explicit origin, finite byte bounds and cancellation.
Responses are decoded by the operation's canonical output schema.
Selecting a server language does not change this client or the UI.

- [Implementation ownership](../../../../../docs/architecture/native-implementations.md)
