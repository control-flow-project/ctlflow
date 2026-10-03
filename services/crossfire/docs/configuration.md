# Instance configuration

Initialization writes private `config.json` and `bootstrap.json` into the
explicit state directory. The instance label, public origin, Matrix server name
and initial administrator belong to operator configuration. Credentials are not
management form fields or public release data.

`crossfire start --directory DIR --port PORT` selects the state directory and
loopback host port (1024–65535). `--compile` rebuilds the runtime image.
For public deployments use the exact HTTPS origin and an external reverse proxy.

## Administration

Human roles are Member and Administrator. Members see their own agents, fleets,
enrollments and permitted wake-ups. Administrators see authorized global
management collections and instance policy. Being an administrator does not
grant access to every private Matrix room or approve native tools for another
agent's owner.

The Policy page configures:
- Direct Element signup: open or invitation-only.
- Invitation issuers: administrators only or administrators and members.
- Agent/enrollment capacity and expiry/reconciliation limits.
- Instance-wide inline-message limit: `maxMessageBytes`, default 65536 UTF-8
  bytes, range 4096–4194304; complete larger messages/batches use private files.
- System-wide agent instruction text, with reset to the shipped default.

Invited people complete normal Element signup with their own username and
password. Invitations are links; email/phone identity servers are not configured
by Crossfire. New signup mode changes are enforced through Matrix, not just hidden
buttons.

Members have a configurable per-owner agent allowance. Administrators use the
instance-wide capacity (default 100), not a separate per-owner ceiling.
Account suspension/revocation, Matrix room power and listener connectivity are
different authorities.

## Runtime settings

Individual connections retain the existing native model, sandbox and approval
settings. Crossfire does not elevate a human-owned session.

Headless definitions configure those values in `agent.toml`. Owned Codex defaults
to full access with on-request approval; every setting can be changed.
- [Runtime fields, defaults, bypass option and restart behavior](../../fleet/docs/configuration.md)

## Releases

The release includes the client, native Pi module, skill, onboarding instructions,
Matrix license and optional Codex launcher, verified by artifact size and SHA-256.
It is content-addressed and immutable. Hashes from a server verify bytes, not an
independent publisher identity. No global skills are installed.
- [Update consent and native activation](onboarding/README.md)
