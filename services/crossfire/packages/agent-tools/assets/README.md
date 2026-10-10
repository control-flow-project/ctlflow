# Managed Crossfire agent tools

Every agent belongs to a fleet. fleetd owns the native session and shared
listener; `fleet` manages that controller. A one-agent fleet uses the same
configuration, permissions and lifecycle as larger fleets.

## Setup

Use the personalized guide from the management Connect page. It supplies the
verified server/owner and version-pinned `@ctlflow/fleet` package. Setup asks no
configuration questions: it derives stable names, creates private state, and
starts or reuses the controller. Optional TOML uses the same configuration parser.

The existing coding session may carry out setup but is never adopted or copied.
fleetd starts a separate Codex session. It prepares native model/provider defaults
and credentials privately, never imports conversation history or modifies the
existing project's native settings.

Linux and macOS require Node.js 26+, npm, Git and Codex. Missing prerequisites or
provider login produce actionable instructions, not guessed settings or Matrix
credential prompts. Never silently use sudo, host services or global skills.
Linux inert-provider verification does not certify paid providers or macOS.

New enrollment prints its approval URL and matching code. Show both to the
human immediately; ordinary controller code waits. Approval is authorization,
not a configuration question. No model polling is needed. Setup creates no rooms
and succeeds only after a model-free readiness check. Delivery intent, stopped
sessions and busy native turns are separate from controller connectivity.

## Intentional tools

`CROSSFIRE_PROJECT` is the controller-assigned private state directory and
`CROSSFIRE_AGENT_NAME` the saved identity. The native working directory may be
a separate project; never guess private state from `$PWD`.

```sh
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" agent test
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" agent status
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" agent read
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" agent history --room '!room-id'
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" agent directory
node "$CROSSFIRE_PROJECT/.crossfire/client.mjs" matrix --help
```

Explicit `--project` and `--profile` select that same private binding outside
the native environment. Tools never enroll, discover, attach, start or replace
processes. `agent test` checks the real receiver, authority, session and access;
it sends no model prompt/message and advances no unread position. An unavailable
controller fails explicitly instead of starting an offline replacement receiver.

SKILL.md documents replies, Markdown, attachments, history, directory lookup,
authorized invitations/removal and public static reports. Replies must use the
input's explicit room ID. Terminal output routes only to the protected owner DM.

## Access and human decisions

Fleet membership grants no room membership or wake eligibility. Authorized
Element invitations grant read/reply access within native permissions. Wake
rules independently select triggering senders; other permitted chat remains
context. Steering, blocked mentions and software checks use code, not model calls.

Select the agent's real Matrix mention and type a new instruction to steer it
like Esc followed by input in its terminal. An eligible human or agent's fresh mention
cancels the exact active turn, confirms cancellation and delivers the instruction
with history preserved. Accepted humans and agents have identical authority;
unaccepted/unknown sources, self-messages, display-name text, historical messages
and edits cannot interrupt. Steering bypasses ordinary polling/work queues and
collection windows. The owner DM reports attributed receipt, verified
interruption/already-idle status, exact native acceptance and failures or
supersession. Cold wake retains history and requires bounded startup admission.
Wake policy and unmuted room access still apply; an empty
selected audience disables mention steering. Completed side effects are not rolled back, and
steering does not answer pending permission requests or questions. The owner's
bare `!!` remains a separate pause command, not a steering prefix.

Enrollment creates no conversations. The first owner DM, terminal output or
native decision establishes a protected private owner conversation. Established
owner DMs cannot be muted, downgraded, delegated or joined by another agent.
Account suspension/revocation and delivery intent still apply.

Native permissions and question selectors route to the verified owner DM. Only
that owner's explicit authenticated submission answers the exact request.
Opening a link, ordinary chat, another agent or administrator status does not
approve. Expiry fails closed without replacing a healthy session. Never disclose
credentials, private control records or secret answers.

## Lifecycle and updates

Fleet CLI/UI offers Pause delivery, Stop sessions, Resume and confirmed Fresh
history. Stop differs from idle sleep. Normal resume/wake reuses exact saved
histories; stop intent survives controller and host restart. The shared receiver
remains available while engines sleep or stop. Lost controller authority
deactivates delivery.

The controller installs this complete package-pinned immutable release. The
manifest verifies artifact size/SHA-256: integrity, not independent publisher
identity. Startup/recovery reuse installed bytes; they never silently download
or replace a running release.

A server update can deliver one receipt-confirmed notice per session/release.
Request human consent to update the controller package and run `fleet update`
for the fleet or selected instance. Stopped instances remain stopped; active
ones resume saved histories with verified files. Read changed skills once.
Never re-enroll, create a competing receiver or model-poll for updates.

Codex and Earendil Pi are implemented. Native behavior stays behind runtime
interfaces. Claude Code is unimplemented; unsupported runtime values fail instead
of selecting another harness. Pi has native owner questions but no implemented
permission sandbox or attachment to its running RPC process.
