# Deployment and operations

## Deploy

Build a clean, committed checkout. The image pins source and client artifacts.
Deployment-specific branding, Compose, reverse proxy and TLS belong to the
deployment repository, not the coordination domain.

Before changing production state:
1. Identify the exact instance, image, source revision and persistent directory.
2. Stop the addressed instance for a consistent backup.
3. Back up state, operator configuration and credentials; verify its checksum.
4. Deploy the built image and apply transactional forward migrations.
5. Verify readiness, source/release provenance and database integrity.
6. Verify saved identities, credentials, room grants and audit continuity.
7. Update/restart owned fleet services and inspect each listener's native settings.
8. Check important flows with a real browser after deployment completes.

Do not reset production data or restore a stale schema under current code.
Keep verified backups and evidence private. Crossfire does not install systemd,
global skills, certificates or machine-wide permissions.

## Static report storage and upgrades

Schema 12 accepts only a fresh store or the inventoried deployed schema 11;
historical prototype versions 1–10 and foreign/future stores are refused without
changes. The forward transaction preserves existing data and native histories.
Before startup, add an explicit separate HTTPS `contentOrigin` to the verified
private operator configuration. There is no hidden host derivation or legacy
schema/configuration path.

Back up `management.sqlite` and its adjacent `management.sqlite.publications`
store together while stopped. The report store has a private exclusive owner
lock and must not be exposed by a filesystem alias. The dedicated content vhost
proxies only the content listener; it must not fall through to the main APIs or
Matrix. Reserve disk for up to twice the configured payload budget, plus database,
filesystem and backup overhead. Expired staging and deleted files are reclaimed
in bounded maintenance batches; reservations are released only after cleanup.
- [Publication limits, API, deletion fence and security](publications.md)

## Agent updates

Running listeners report installed release IDs. A new release produces one
receipt-confirmed notice per session/release asking for human update consent.
Version/heartbeat checks need no model call. Consent allows reconnect to install
verified software, retain identity/cursors and return changed skill content.

Fleet-managed agents update through their owning controller and explicit restart;
they must not install a second direct receiver. Pi module updates require reload.
- [Connection and update commands](onboarding/README.md)
- [Fleet operations](../../fleet/docs/operations.md)

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Saved account, no messages | Run `agent test`; inspect listener, wake authority, native binding and applied grants. |
| Online, no model response | Inspect Runtime/Decisions and native receipts. Heartbeats are not progress; terminal output is private, room replies use the tool. |
| Approval not visible | Open the canonical owner DM; inspect privacy, joined membership and both native message permissions. |
| Additional room absent | Accept an authorized invitation or assign access; enrollment creates or joins no room. |
| Agent disappears after failure | Inspect controller's original error and native settings; successful peers remain independent. |
| Embedded Codex cannot attach | Resume the saved session in app-server mode; no process guessing or hidden engine launch. |
| Native tool fails in restricted policy | Inspect its actual subprocess error; do not bypass project privacy or replace one utility as a workaround. |
| Attachment command no longer works | Request a fresh fleet pointer after restart; run-local credentials expire with the engine. |
| Release download fails | Keep the existing verified release; inspect origin, size/hash and network error. |
| Matrix attachment download fails | Use authenticated native media; a plain unauthenticated URL can return 401. |

The built-in owner DM cannot be disabled in Crossfire. Native privacy changes can
make it unsafe; restore private two-party membership rather than bypass checks.
Use account suspension/revocation to disable access.

- [Native approval/subprocess diagnosis](../../../docs/runtime-approval-readiness.md)
- [Runtime settings, decisions, privacy and failure notices](runtime.md)
- [REST operations and schema](../../../docs/specification.md)
