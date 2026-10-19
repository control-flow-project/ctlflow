# fleetd operator tools

Build the workspace and run as the controller's owning Unix user:

```sh
node services/fleetd/dist/tools/main.js --help
node services/fleetd/dist/tools/main.js verify \
  --root /absolute/private/controller --directory /absolute/private/fleet
```

Use absolute owned private paths. Remote inspection runs on the controller host
through normal verified SSH; do not copy/expose its socket or private state.

## Read-only verification

| Option | Meaning |
| --- | --- |
| --root | Existing controller root |
| --directory | Exact registered fleet directory |
| --running | Require enabled connected running listeners/instances |
| --fresh | Also require authenticated idle histories with zero turns |
| --no-rooms | Require every enrolled agent's native joined-room list empty |
| --skills | Distinct required project skill names, comma separated |
| --snapshot | Save private account/history/provider-file fingerprints |
| --preserve | Compare an earlier exact private snapshot |
| --output | Save the private report |

Inspection validates roster, owner/server/fleet binding, actual configured native
settings, saved contexts and requested skills.
Codex reads its current native endpoint without turns, answers or thread resume.
Unsolicited native decisions close the inspection connection without answering.

Pi has no equivalent live attachment inspector; unsupported inspection fails.
Do not launch another native writer to approximate it.
Ordinary fleet status/contexts remain available.

Snapshots retain exact account/context/session identities and provider-file
fingerprints. Appended instances/files are allowed only while all earlier
entries remain present and exact. Hash equality is not conversation-quality or
paid-provider evidence. IDs, paths, digests and screenshots remain private.

## Explicit Pi provider acceptance

This command sends actual model requests only with `--execute`.
The normal regression bank uses inert providers and does not run it.

```sh
node services/fleetd/dist/tools/pi-provider-acceptance.js \
  --binary /absolute/private/pi-install/node_modules/.bin/pi \
  --provider EXACT_PROVIDER --model EXACT_MODEL --thinking-level medium \
  --evidence /absolute/private/provider-evidence --execute
```

Run inside a verified finite resource scope with selected native 1.0.0 and
authorized login. Evidence must be a separate existing private directory.
It never targets a registered fleet or production history.

The proof exercises native responses/files, owner questions, interruption,
stale-run fences, auth recopy, saved resume, idle-process crash recovery,
per-room contexts and usage. It kills only the verified exact idle synthetic PID.
Budgets are at most 32 measured responses and 250000 measured tokens, not a
guaranteed billing ceiling.

Reports contain checks/timings/usage/failure phase, not credentials, responses or
thinking. Owned processes close before temporary native homes are removed.
Failed cleanup is reported. One provider/model/Linux run does not certify every
provider, platform, crash or detached subprocess.

- [Native context conversion](../../docs/storage.md)
- [Controller operations](../../docs/operations.md)
