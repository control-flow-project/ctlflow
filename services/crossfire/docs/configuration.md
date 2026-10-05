# Instance configuration

Initialization writes private `config.json` and `bootstrap.json` into the
explicit state directory. The instance label, public origin, Matrix server name
and initial administrator belong to operator configuration. Credentials are not
management form fields or public release data.

`crossfire start --directory DIR --port PORT --content-port CONTENT_PORT` selects
the state directory and distinct loopback host ports (1024–65535); content defaults
to port 8082. `--compile` rebuilds the runtime image. Required `contentOrigin`
selects a dedicated content hostname, separate from the application and Matrix
hosts. For public deployments use exact HTTPS origins and separate reverse-proxy
vhosts; no origin is inferred. Optional `publicationBudget` configures finite
reserved bytes, report counts and concurrent uploads.
- [Content configuration, defaults and physical disk overhead](publications.md)

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
- Fleet native-session idle timeout: `fleetIdleTimeoutSeconds`, default 1800
  seconds (30 minutes), range 0–604800; zero disables automatic sleep. This policy
  is delivered to fleetd and does not shut down individual human-owned sessions.
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
