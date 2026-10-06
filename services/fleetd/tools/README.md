# Fleet controller operator tools

Run these tools from a built Crossfire source checkout on the controller computer.
They are internal operator tools, not additional public npm packages. Keep reports
and backups private. The commands use the existing runtime and storage interfaces.

## Read-only verification

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

### Options

| Option | Meaning |
| --- | --- |
| `--root` | Exact existing private controller root |
| `--directory` | Exact registered fleet directory; each instance's native workspace determines its project boundary |
| `--running` | Require connected/enabled delivery and every instance/listener running without an error; omit for sleeping receivers |
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

### Assertions

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
  from each native workspace to its actual Git root, plus requested skill names.
  The private fleet/state directory need not belong to that Git project. Workspaces
  without Git metadata have no inferred ancestor Git boundary. Role/Crossfire
  instructions delivered through native developer instructions are not discovered
  project skills and are not falsely claimed as such.
- Optional native membership checks require zero joined rooms for each account.
- Preservation retains exact enrolled account IDs, all context/session IDs and
  native provider-authentication file fingerprints for every earlier instance.
  New instances/files may be appended after the ordinary roster/enrollment
  review; the complete current roster and native state are still validated.
  Missing or changed earlier entries and duplicate snapshot identities/paths fail.
  History content and provider behavior are not inferred from these fingerprints.

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

## Observation metadata conversion

The deployed pre-idle observation schema lacks `lastActivityAt` and
`historyAvailable`. Its pending observations must be converted before activation
with the current strict schema. This is an explicit forward conversion, not a
runtime fallback. Unknown historical metadata becomes `null`; timestamps and
history availability are not guessed. Existing current observations are unchanged.
Pending terminal output is preserved without interpreting or discarding it.

Verify a fresh consistent full controller/fleet backup, then stop the controller
normally. This preserves desired activation and closes its owned native processes.

```sh
fleet daemon stop --root /home/operator/controller
node services/fleetd/dist/tools/main.js migrate-observations --root /home/operator/controller --directory /home/operator/fleets/research --backup /home/operator/evidence/observation-backup --output /home/operator/evidence/observation-migration.json
fleet daemon start --root /home/operator/controller --name workstation
```

The backup path must be new, absolute and outside the controller/fleet state.
Exclusive controller, listener and receiver locks reject active writers. Exact
enrolled identities and every known observation are checked before any journal
changes. All selected original bytes are durably backed up and reread before the
first atomic conversion. The backup manifest identifies each original hash.
Profiles, message positions, native histories and provider files are not changed.

Each file replacement is atomic and durable. A failure stops the command, reports
the number of verified replacements and returns nonzero. Keep its backups;
inspect the failure before retrying with a new backup directory. Already-current
files are no-ops, so an interrupted conversion does not duplicate observations.
No other historical journal schema is accepted. Current runtime validation remains
strict; this conversion is not certification of opaque terminal-output contents.
