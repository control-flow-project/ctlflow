# Deployment and operations

## Deployment boundary

Build a clean, committed checkout. The image pins source, management assets and
intentional agent tools. Site branding, Compose, reverse proxy and TLS belong to
the deployment repository, not the coordination domain. Publishing npm packages,
deploying the website and starting fleets are separate authorized actions.

Before changing production state:
1. Identify the exact instance, image, source revision and persistent directory.
2. Stop the addressed instance for a consistent backup.
3. Back up database, report store, operator configuration and credentials;
   verify that backup before mutation.
4. Deploy the selected image and its transactional forward migration.
5. Verify readiness, source/tool release provenance and database integrity.
6. Verify identities, credentials, grants, histories, receipt/audit continuity and
   the intended history-only archival of formerly unbound identities.
7. When authorized, explicitly update controller-owned tool assets, restart the
   selected controller and inspect real binding/settings evidence.
8. Check important flows with a real browser after deployment completes.

Do not reset production, rewrite schema versions, discard native histories or
restore a stale schema under current code. Keep backups/evidence private.
Crossfire installs no systemd, global skills, certificates or host permissions.

## Schema and report storage

Schema 13 accepts a fresh store or the inventoried deployed schema 12 only.
Versions 1–11 and foreign/future stores fail without mutation. Conversion retains
identities, native credentials, histories, grants, publications, receipts and audit.
Historical requests missing mandatory controller fields or successful-item policy
become immutable history-only archive relations. All fourteen original request
fields and normalized item/policy/permission/selected-sender/metadata rows retain
their exact values. Complete managed requests remain current; no fleet or policy
is invented during conversion. The current inventory has 63 singular tables.
Unbound historical identities are excluded from operational authentication and
directories until a new owner-reviewed fleet enrollment proves private identity.
Every new reporting run requires its exact active fleet/current controller lease.
Archive/retirement timestamps and native-stop receipts do not authorize data loss.
Management and Fleet CLI use the same archive resource and expected revision.
An authorized human or the owning authenticated controller can archive; controller
archive also requires its current live lease. Both require settled native-stop
evidence, then retain history, close the lease and revoke controller credentials.
- [Normalized tables and migration contract](../../../docs/specification.md)

Configure an explicit separate HTTPS `contentOrigin`. There is no hostname
derivation, old-schema reader or alternate configuration path. Back up
`management.sqlite` and its adjacent `management.sqlite.publications` store
together while stopped. The report store has a private exclusive owner lock;
never expose it through a filesystem alias. The content vhost proxies only the
content listener, not main APIs or Matrix. Reserve twice the configured payload
budget plus database, filesystem and backup overhead. Expiry/deletion cleanup is
bounded; reservations remain until cleanup succeeds.
- [Publication limits, deletion fence and security](publications.md)

The operator accepts `crossfire start --cgroup-parent EXISTING.slice` to place
Docker build steps and its runtime container under an existing resource budget.
It validates and passes that exact slice; it never creates host services or
configures resource policy. Omit the flag when the operator supplies no budget.
Repository container verification creates its own temporary bounded test slice.

## Software updates

Running agent bindings report their installed tool release. A different offered
release produces one receipt-confirmed consent notice per native session/release.
Checks and reporting make no model call; the notice asks the human to approve
the update. Sleeping agents are not woken solely for maintenance.

After consent:
1. Install the exact version-pinned `@ctlflow/fleet`/`@ctlflow/fleetd` release.
2. Run `fleet update FLEET` or `fleet agent update FLEET INSTANCE` using the
   newly installed CLI. It verifies that package's bundled local assets and
   explicitly stops/installs/resumes selected desired-active instances.
3. Run `fleet daemon restart --root /absolute/controller` with the new installed
   executable. Saved desired stop/resume intent, identities, histories, grants
   and unread receipts remain authoritative.

For a remote controller, `--release-directory` is required to name already
installed verified assets on that remote machine, or run the installed CLI there;
no HTTP fallback/download occurs. Repeated setup, ordinary recovery and sleep/wake
use installed software,
not implicit upgrades. An explicitly stopped instance stays stopped.
- [Setup and update commands](onboarding/README.md)
- [Fleet operations](../../fleet/docs/operations.md)

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Saved account, no messages | Run `fleet test FLEET` or the managed `agent test`; inspect active binding, wake authority and applied grants. |
| Online, no response | Inspect Session decisions and Activity native receipts. Heartbeats are not progress; terminal output goes to the owner, room replies use the messaging tool. |
| Approval absent | Inspect the canonical owner DM, privacy, current membership and both participants' native message permission. |
| Additional room absent | Accept an authorized invitation or assign access; enrollment joins/creates no rooms. |
| One agent fails | Inspect the original adapter/controller cause; successful peers remain independent. Transient recovery retains exact saved history. |
| Resume says `already has an active writer` after daemon force-kill | The original native app-server may still hold that exact private history. Resolve the confirmed surviving owned process; never delete history/locks, guess ownership from process names or start a fresh conversation to bypass the refusal. |
| Existing coding session unchanged | Expected: setup creates another managed conversation, not an attachment to that coding session. |
| Terminal command stale | Get a fresh exact running-context pointer after Resume/restart. Run-local private credentials end with the old engine. |
| Native tool denied | Inspect the actual subprocess/permission error. Fix the native capability owner; do not substitute one utility to evade policy. |
| Update assets invalid | Keep the installed verified release; inspect the local pinned manifest/bytes and selected release directory. No silent download or fresh session is allowed. |
| Retirement/archive unavailable | Stop sessions and settle pending decisions/deliveries first. Offline or sleeping is not receipt-confirmed native close. |
| Matrix media download denied | Use authenticated native media operations; an unauthenticated URL can return 401. |

The protected owner DM cannot be disabled in management. Native privacy drift
can make it unsafe; restore verified private two-party membership rather than
bypassing checks. Suspension/revocation remain the account-access owners.
- [Native approval/subprocess diagnosis](../../../docs/runtime-approval-readiness.md)
- [Settings, decisions, privacy and failure notices](runtime.md)
