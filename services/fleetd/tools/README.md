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

## Native runtime verification

Use the shared native runtime and installed-product suites described in the
[development guide](../../../docs/development.md). They exercise Codex and Pi
through the selected native implementation with inert providers. No paid-model
request or production fleet activation is part of those suites.

- [Controller storage](../docs/storage.md)
- [Controller operations](../docs/operations.md)
