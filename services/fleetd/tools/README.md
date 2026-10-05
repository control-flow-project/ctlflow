# fleetd operator verification

The controller's read-only operator command inspects existing registered fleets,
their exact account/history bindings and native runtime settings. It does not
launch, reconnect, stop or upgrade runtimes. Lifecycle operations remain in the
Fleet CLI.

Build the workspace, then run on the controller's machine as its owning Unix user:

```sh
node services/fleetd/dist/tools/main.js verify --root /home/operator/controller --directory /home/operator/projects/agents/fleets/research --running --skills search,coordination --snapshot /home/operator/evidence/fleet-before.json
```

The same entry is available as
`npm run tools --workspace=@ctlflow/fleetd -- verify ...`. All paths are absolute.
The root and Unix socket must be owned, private and canonical; the command uses
Fleet's exported daemon client with the current private API. Run through SSH on
remote hosts rather than copying private controller state or exposing the socket
as a public service.

```sh
ssh operator@controller-host 'node /home/operator/crossfire/services/fleetd/dist/tools/main.js verify --root /home/operator/controller --directory /home/operator/projects/agents/fleets/research --running --preserve /home/operator/evidence/fleet-before.json --output /home/operator/evidence/fleet-after.json'
```

## Options

| Option | Meaning |
| --- | --- |
| `--root` | Exact existing private controller root |
| `--directory` | Exact registered fleet directory, inside its actual Git project |
| `--running` | Require connected/enabled delivery and every instance/listener running without an error |
| `--fresh` | Require `--running`, authenticated idle histories and zero native turns |
| `--no-rooms` | Check every enrolled agent's native joined-room list is empty |
| `--skills` | Comma-separated distinct required project skill names |
| `--snapshot` | Save private account/history/provider-file fingerprint preservation evidence |
| `--preserve` | Compare against the exact earlier private preservation snapshot |
| `--output` | Save the private full verification report |

Unknown/duplicate options and malformed private evidence fail. Snapshot and output
files use the filesystem adapter's private atomic writes. Reports contain IDs,
configured model/effort, state, history mode, message limit, skill paths and file
digests, never provider credentials, Matrix tokens or controller credentials.
Treat IDs/paths/digests as operator evidence, not public telemetry.

## Assertions

- Configured server/owner/fleet key match the saved approved binding.
- One registered fleet owns the directory; its complete current roster and each
  definition/workarea match the controller view.
- Every existing context uses its configured runtime and unique native history.
  Running instances have inspectable histories. Attachment pointers must identify
  the exact registered workspace and session; no ID guessing or process scanning.
- Codex is authenticated; native thread input capability, workspace and state
  are inspected. Configured model and reasoning effort must be available from
  the runtime's model catalog. This proves availability, not paid execution.
- Native skill discovery must include every ancestor `.agents/skills/*/SKILL.md`
  from the workarea to the actual Git root, plus requested skill names. A plain
  archive is not a substitute for the native Git-based project boundary.
- Optional native membership checks require zero joined rooms for each account.
- Preservation retains exact enrolled account IDs, all context/session IDs and
  native provider-authentication file fingerprints for every earlier instance.
  New instances/files may be appended after the ordinary roster/enrollment
  review; the complete current roster and native state are still validated.
  Missing or changed earlier entries and duplicate snapshot identities/paths fail.
  History content and provider
  behavior are not inferred from these fingerprints.

Native inspection lives under `tools/runtime/` with explicit supported-runtime
dispatch. Codex is the currently supported fleet runtime. Unsupported runtimes
fail rather than using an approximate inspector. The Codex inspector reuses the
native adapter's authenticated protocol and settings validation. It uses only
initialization, account/thread/model/skill reads: no `turn/start`, `thread/resume`,
model inference or native answer. An unsolicited permission/question request
closes the inspection connection without answering it or taking over the runtime.

This is Linux-verified, read-only evidence. A nonrunning inspection cannot certify
native readiness; `--fresh` is meaningful only before the first actual assignment.
All business lifecycle changes and account approval stay at their existing owners.
