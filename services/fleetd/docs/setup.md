# Controller-owned project setup

## One execution model

Every Crossfire agent belongs to a fleet. Project setup creates a normal
one-instance roster; larger role fleets use the same configuration, enrollment,
controller, runtime adapter and shared listener. Codex is the implemented runtime.
Unsupported runtimes fail validation; no standalone path or placeholder adapter
is retained.

The CLI validates the personalized descriptor and submits `POST /api/setup` to
the existing private controller API. Domain ports own storage, prerequisite
inspection, durable lifecycle and readiness. The coding session doing setup is
not adopted, copied or imported. The CLI never launches native agents directly.

## Verified descriptor

`GET /onboarding/setup.json?ownerMatrixId=...` belongs to Crossfire and verifies
the active registered human owner. Its canonical JSON contract is:

```json
{
  "schemaVersion": 1,
  "server": "https://YOUR_SERVER",
  "ownerMatrixId": "@YOUR_ACCOUNT:YOUR_SERVER",
  "package": { "name": "@ctlflow/fleet", "version": "0.1.0" },
  "instructions": "Instructions set by this instance's administrator"
}
```

The CLI checks the strict canonical schema, exact requested origin/owner and exact
installed public package version. It rejects redirects, ambiguous queries,
credentials in URLs, public HTTP, malformed UTF-8 and oversized responses.
Administrator instructions follow the normal role/native developer-instruction
mechanism. Neither descriptive labels nor the descriptor bypass human enrollment
approval.

## Durable defaults and overrides

Without `--config`, controller storage derives a stable private project directory
from the canonical workspace, verified server and owner. A valid lowercase name
is generated once and persisted in `runtime.toml`. The private registry retains
the same initial operation until completion. Repeated setup observes pending
approval, retries a failed incomplete operation or returns the existing ready or
explicitly stopped binding. It never creates another account for a retry or
silently reactivates a stopped instance.
When its controller is restoring a saved fleet, setup awaits that fleet's current
bounded restoration attempt. It does not start a competing native generation or
wait for unrelated fleets. Status and explicit stop remain available throughout.

`--config /absolute/runtime.toml` loads an ordinary existing roster. Its server
and owner must match the descriptor; names are validated exactly, never
normalized. All role files, instructions and native options follow the same
configuration loader. Existing approved identities remain immutable.

| Location | Owner and contents |
| --- | --- |
| Private controller root | Controller descriptor, registrations, desired intent, operations, setup records, log and Unix socket |
| Fleet `.fleet` | Approved accounts/controller binding, accepted history initialization, reset and failure evidence |
| Instance `workarea` | Private persistent native history/provider configuration and `.crossfire` tools/receipts/unread positions |
| Optional instance `workspace` | Native cwd only; defaults to the private workarea |

Generated project setup points `workspace` at the human-selected existing
project and keeps `workarea` beneath the private controller project directory.
The runtime receives both `workspace` and `stateDirectory`. It does not chmod
the existing project, overwrite its `.codex` configuration/history or install
global skills. Role instructions, administrator instructions and the pinned
Crossfire skill are native developer instructions on first create and resume;
the external cwd need not discover private workarea ancestor skills.

### Provider login on resume

The controller's host `CODEX_HOME` (default `~/.codex`) owns the authorized Codex
provider login. Each actual native activation atomically refreshes its private
`auth.json` from that source: initial startup, UI/CLI resume, automatic message
wake, restored binding and failure recovery all use the same runtime adapter.
Sign in on the controller host with `codex login`, then stop/resume any already
running engines that need the new account. A running engine is not hot-switched
by a status check or another agent's preflight.

Only the bounded owned private login file is copied. Model/provider configuration
is initialized once and retained; configured instance parameters still apply.
Native histories, saved session UUIDs, Matrix identities, room access and unread
positions are not replaced. The independent coding session is not adopted.
An invalid, unreadable, oversized or unsafe source fails before native execution.
There is no stale credential fallback. A missing source removes an old file copy;
native environment/provider authentication remains native-owned. Provider-account
and billing changes therefore follow the current host login on the next resume.
Do not paste credentials into Matrix or management forms.

The native runtime receives the immutable instance key as its required tool
profile, separately from its human-readable name. CROSSFIRE_AGENT_NAME carries
that key and CROSSFIRE_PROJECT carries private state. A display-name change never
changes the profile, credential, cursor or saved native history. All intentional
tools, including report publication, use this binding; missing/invalid keys fail
before native startup, without an alias or a guessed identity.

## Approval, readiness and failure

Model-free runtime inspection precedes enrollment. Missing Codex, native
capabilities, authentication or unsafe state is an actionable failure, not a
configuration prompt or a guessed replacement identity. The owner sees the exact
approval URL/code while code waits. Accepted controller operations outlive CLI
disconnect; repeats retain their operation/registration identity.

Setup succeeds only after controller connectivity, desired native bindings and
the actual shared listener's private diagnostic agree. `fleet test FLEET` uses
the same domain readiness port and live listener control path. It creates no
model turn, conversation, native resume or unread-position change. Busy, paused,
unavailable or stopped execution does not pass. A sleeping receiver can pass
without waking its native process. Explicitly stopped repeat setup returns
`stopped` and never submits a start.

First setup creates no Matrix rooms or conversations. Protected owner DMs open
only on first contact, actual visible output or a real pending native decision.
Authorization, admission and wake eligibility remain Crossfire-owned.

## Pinned tools and explicit update

Public fleetd bundles contain the canonical four agent-tool artifacts and
manifest built by the private `@ctlflow/crossfire-agent-tools/build` export.
Web release and npm distribution use the same builder and bytes. Initial
installation reads package-local assets; recovery/restart retains installed
assets. There is no HTTP controller installer or standalone reconnect fallback.

After owner consent, install the exact new public release. Its CLI resolves the
declared `@ctlflow/fleetd/artifacts` export and requests a controller-owned
`update` operation with that absolute `releaseDirectory`. The controller stops
selected receivers/native processes, validates and installs the immutable local
release, then resumes only previously desired instances with exact histories.
Stopped intent is preserved. The advanced directory option addresses a real
installed source on an SSH controller, not a different lifecycle path.

Run `fleet daemon restart` with the new executable after successful asset update
to replace daemon code while retaining intent/history. Update failures remain
visible per instance. No silent upgrade, re-enrollment, fresh history or implicit
host service installation occurs.
