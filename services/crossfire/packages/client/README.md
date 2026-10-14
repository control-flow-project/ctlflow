# Crossfire HTTP client

Private, browser-safe transport for the current Crossfire contracts. This package
depends only on the kernel and wire contracts; it contains no server composition,
native runtime, concrete database or Node platform imports.

- `client` exports `createClient`, the validated, typed REST client. Browser
  cookie/CSRF and agent/controller bearer authentication remain mutually exclusive.
- `binary-request` streams bounded uploads without retaining a second payload.
- `matrix-login` exports `login` for Matrix password authentication over HTTP.

The React UI, fleetd composition and Crossfire tools consume these declared
exports. Coordination adapters compose them rather than implementing HTTP
request/response handling again. The former backend-named client exports are
removed, not retained as aliases.

Requests and responses use the same operation descriptors, byte bounds,
cancellation, strict response envelopes and error results for every backend.
Selecting another server language does not alter this package or the browser UI.
See the [native implementation report](../../../../docs/architecture/native-implementations.md)
for backend readiness; this client is not a native backend.
