# Controller-owned setup

## Entry

fleet validates crossfire's personalized setup descriptor and submits
`POST /api/setup` to the private controller API.
An existing coding assistant may execute that command, but its process and
conversation are never imported or attached.

Management supplies a personalized guide; the user's local coding assistant runs
its pinned npm installation and setup command on the Linux/macOS execution host.
The browser/server does not install software on that host. No .NET/Rust
installation is needed. The guide installs only fleet/fleetd and requires an
existing supported Codex/Pi installation and native provider login. It does not
install/upgrade a harness, run agents in Docker or copy credentials into Docker.
fleetd initializes private OS-native authentication before setup calls its API;
fleet reads that same file and sends its key automatically.

The descriptor identifies one active registered human, exact server origin and
exact installed public fleet version. Unknown fields, redirects, origin/owner
substitution, ambiguous queries, oversized data and malformed text fail.
Administrator instruction text grants no additional authority.

## Defaults

Without explicit configuration, storage derives one stable private project
directory from canonical workspace, verified server and owner.
The initial operation, generated valid names and roster are persisted before
submission. Retry reuses the same enrollment, identity and history.

Defaults include the existing/new local controller, native model selection,
shared history and crossfire's instance idle/message policies.
Codex defaults to danger-full-access/on-request with bypass disabled.
A missing native prerequisite/login is actionable failure, not a configuration
question or silent fallback.

`--config /absolute/runtime.toml` selects the ordinary validated roster.
Its server and owner must match the descriptor. `--root` selects the controller
root through the same owner. Neither option creates another setup path.

## Enrollment and readiness

The controller preflights the whole roster, persists exact private claim material
and displays one owner approval URL/code. The human reviews identities and
coordination defaults. Approval does not grant room membership.

Credential exchange and native initialization use ordinary code.
The controller installs verified local tool assets and checks actual listener/
native readiness without a dummy model prompt or preemptive chat.

If setup was interrupted, its stored operation is observed or retried.
If its binding was explicitly stopped, repeated setup returns Stopped.
It does not reactivate it. Restoration of the same fleet is awaited rather than
starting a competing generation.

## Existing identities

Approved resume validates saved controller/fleet/owner/account bindings.
It does not enroll again, overwrite human wake rules or change credentials.
Explicit enrollment is required to propose new/renamed identities or changed
coordination defaults. Public names cannot recover lost private authority.

- [Fleet configuration](https://github.com/control-flow-project/ctlflow/blob/main/services/fleet/docs/configuration.md)
- [Enrollment protocol](https://github.com/control-flow-project/ctlflow/blob/main/services/crossfire/docs/onboarding/README.md)
- [Controller operation](operations.md)
