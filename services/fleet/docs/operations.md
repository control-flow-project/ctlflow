# Fleet operations

## Update and deploy

Use a verified committed build. Before deployment, stop addressed agents/controller
and back up the private controller root, fleet directory and provider state.
Verify checksums before replacement. Keep credentials out of logs and source.

Update controller/CLI code and the relevant definitions, then start the same
controller/root and fleet. Each saved instance reuses its identity, session UUID
and delivery state. Check all per-instance outcomes and effective native settings,
not just controller connectivity. Native approval requests use the canonical
owner DM. Do not assign shared-room access merely to make a test respond.

Running listener releases are not silently replaced. Fleet-managed update notices
ask the human to update the owning controller and restart affected instances;
they must not create a competing direct listener.

## Backup and portability

A stopped fleet directory contains its definitions, private Crossfire binding,
work areas, sessions and receipts. Preserve private modes, credentials and native
provider configuration when transferring it. The target requires the same runtime
and provider prerequisites. Register its new absolute directory explicitly.
The controller registry is machine-local; the fleet's private state is not a
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
| Permission request waits | Open the private owner DM and reply to the exact request. |
| Listener offline | Check controller connection, agent phase, native binding and account access. |
| Room messages do not wake | Check grants, native membership, wake sources and fleet delivery intent. |
| Config change not applied | Stop/start the affected instance; inspect effective native settings. |
| Terminal pointer expired | Obtain a fresh attachment after restart. |
| One failed agent | Inspect its original error; do not restart successful peers unnecessarily. |

Normal stop ends owned listeners and Codex engines. The product does not supervise
every detached tool descendant after force-kill/crash. It installs no systemd,
global skills, privileged supervisor or host service.
