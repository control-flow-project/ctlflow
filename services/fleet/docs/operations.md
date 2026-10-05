# Fleet operations

## Update and deploy

Use an exact verified public package release after human consent. Before changing
production state, back up and verify the private controller root, fleet directory
and provider state. Preserve private modes; keep credentials out of logs/source.

Install the new matching `@ctlflow/fleet`/`@ctlflow/fleetd` release into the private
durable user prefix. Merely installing a package does not replace live code.
Using that new installed executable, run `fleet update FLEET` for each addressed
fleet, or `fleet agent update FLEET INSTANCE`. The canonical lifecycle operation
stops selected receivers/native processes, validates and installs the package's
pinned local tools/skill assets, then resumes only previously desired agents.
Stopped agents stay stopped. Exact identities, histories and unread positions are
retained. Failures are per-instance, without discarding successful peers.

Then `fleet daemon restart` replaces the controller binary at the same private
root, preserving desired activation and exact histories. Do not reverse this
order and resume with old skills before update. Native approval requests use the
protected owner DM. Check `fleet show FLEET`, `fleet test FLEET` and effective
settings, not just controller connectivity. No room grants are needed for a
model-free readiness check.

Running releases are never silently replaced. Update notices ask for owner
consent and direct the model to the controller-owned command; no standalone
agent connect, second installer or competing receiver exists. The advanced
`--release-directory` addresses an actual immutable installed artifact directory
on the controller computer, including SSH targets; it is validated before use.

## Backup and portability

A stopped fleet directory contains its definitions, private Crossfire binding,
work areas, sessions and receipts. Preserve private modes, credentials and native
provider configuration when transferring it. The target requires the same runtime
and provider prerequisites. Register its new absolute directory explicitly.
Preserve the private controller root, including `desired-intent.json`, when
restarting on the same machine. Daemon shutdown retains active intent; explicit
fleet/agent stop clears it. The controller registry is machine-local; the fleet's private state is not a
public lookup or identity-recovery credential substitute.

Never run two controllers against the same active private fleet state. Exclusive
native locks own controller, fleet and receiver lifetimes; timeout guessing is
not ownership. Do not remove state to bypass a lock or failed resume.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Pending approval | Review the roster URL/code; do not enroll again or poll with a model. |
| Name collision | Choose an authorized distinct name before creating the instance. |
| Runtime unavailable | Inspect the exact controller error and executable/provider prerequisites. |
| Native state sleeping | The listener can still be online. Eligible input resumes retained history; metadata GETs never wake it. |
| Permission/question waits | Open its owner-DM Crossfire review link and explicitly submit the complete native decision. |
| Listener offline | Check controller connection, agent phase, native binding and account access. |
| Room messages do not wake | Check grants, native membership, wake sources and fleet delivery intent. |
| Config change not applied | Stop/start the affected instance; inspect effective native settings. |
| Terminal pointer expired | Obtain a fresh attachment after restart. |
| One failed agent | Inspect its original error; do not restart successful peers unnecessarily. |
| Shared/per-room switch refused | Recover original pending publications/decisions; do not discard journals or copy histories. |
| Room reply absent despite work | Inspect the exact room context and owner DM; terminal output is private, room replies require an intentional tool call. |

Session in management shows native state/settings and decisions independently of
heartbeats. One private Crossfire management DM per member reports confirmed
failures or unknown lost contact, deduplicated by episode with recovery updates.
Controller failures persist in `.fleet/failures.json` until the scoped report is
accepted. A reporting failure is visible in controller status; it does not
silently discard the original failure. The controller closes the exact failed
generation and retries transient failures with one-to-sixty-second exponential
backoff, preserving deployed parameters, installed software, identity and native
history. Explicit stop cancels recovery. Permanent configuration/authorization
errors and failed cleanup require operator action. Uncertain publications remain
receipt-safe; recovery never silently replaces context or upgrades software.
- [Runtime observation, privacy and decisions](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/runtime.md)

Normal stop ends owned listeners and Codex engines. The product does not supervise
every detached tool descendant after force-kill/crash. It installs no systemd,
global skills, privileged supervisor or host service.
