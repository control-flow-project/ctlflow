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
Optional `loggingRetentionDays` controls all owned logging history and diagnostic
files, defaulting to 7 when omitted. It is a positive exact integer, not a string
or an unlimited-retention switch. Service restart applies a private-file change.
- [Logging families, controller configuration and preservation](logging.md)
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
  is delivered to fleetd. The shared receiver remains active while native
  sessions sleep; explicitly stopped sessions do not wake on incoming messages.
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

Every agent uses a fleetd-owned native session. Definitions configure its
model, reasoning, sandbox and approval policy in `agent.toml`. Codex defaults to
full access with on-request approval; every accepted setting can be changed.
Zero-question project setup uses the configured native model/provider defaults
without importing the existing coding conversation or its approval bypasses.
Optional `workspace` selects native tool cwd separately from private state.
The Session tab shows configured/effective values and their observation times.
- [Runtime fields, defaults, bypass option and restart behavior](../../fleet/docs/configuration.md)

## Releases

The tool release contains exactly the client, skill, README and Matrix license,
verified by artifact size and SHA-256. One private builder generates the same
immutable release for Crossfire and the public fleetd distribution. The installed
controller package supplies pinned local artifacts. Recovery/reconnect does not
download or silently replace software. Only Fleet and fleetd are public npm
packages; internal modules remain private and bundled. No global skills are
installed. Settings shows current/latest releases; explicit consent precedes
controller update.
- [Setup and software updates](onboarding/README.md)
