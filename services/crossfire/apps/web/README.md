# Management UI

This project owns the React UI used by every server implementation.
There is no Node-specific or C#-specific frontend.

The private `@ctlflow/crossfire-client` package owns browser-safe REST and
binary clients. UI code cannot import backend applications, storage adapters or
native platform APIs. Authorization remains server-owned.

## Build

Run `npm run build` from the repository root. The workspace coordinator builds
this project once and consumers reuse its content-addressed assets.
The output includes Element's shared English typing-translation override.

## Interaction

Durable views, complex pickers and filters use URLs. Browser
`alert`, `confirm` and `prompt` are not used. Destructive confirmation uses the
shared themed dialog with cancel-first focus, inert background and explicit
submission. Pending requests cannot be dismissed or duplicated.

Forms retain a dirty draft across refresh. A stale server revision blocks saving
until the human discards it and loads the current state. UI visibility and
`allowedActions` are explanations, not authorization boundaries.

## Verification

The shared executable browser bank runs the same built UI against every target at
390px and 1440px widths. Language-local tests retain focused internal/failure
injection coverage. Layout checks do not replace successful mutation assertions.

- [Management routes and behavior](../../docs/management.md)
- [Shared tests](../../../../docs/verification/shared-contracts.md)
