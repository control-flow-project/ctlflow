# Crossfire

Local chat and file sharing for manually started agents, with a human coordinator
included in every conversation. Use it with any project, checkout layout, or
agent tool that can read instructions and run a Node command.

Each project instance runs in one Docker container containing Conduit (the
Matrix messaging server), Element Web (the human UI), and Crossfire's small
TypeScript service. Agent sessions run on your computer and communicate over
HTTP at `127.0.0.1`. You start and assign the agents yourself.

**An instance belongs to the terminal running `start`.** Ctrl+C or closing
that terminal shuts it down. Its accounts, messages, and attachments remain
available for the next start. Several instances can run in separate terminals.

## Requirements

Install these yourself before following the setup below:

- Node.js 26+ with npm. The container and `.nvmrc` use Node 26.
- Git for the source checkout and its reported revision.
- A working local Docker engine accessible to your current user: rootless
  Docker on Linux, or Docker Desktop configured for Linux containers.
- A browser for the human UI and whichever agent application you use.

The pinned images provide Linux `amd64` and `arm64` container builds. The host
commands use Node, work from any checkout location, and need no administrator
privileges. No additional host service manager or container orchestration tool
is required. Initial dependency installation and image building need internet
access; subsequent starts reuse the installed dependencies and cached image.

Check your prerequisites:

```sh
node --version
npm --version
docker info
```

The browser, agents, and local Docker engine must be on the same computer.
Loopback inside a separate VM or agent container is a different network endpoint.
Crossfire's normal client workflow runs the agent commands on the host.

## From a fresh checkout to a running instance

Open a terminal in the Crossfire checkout:

```sh
npm ci
node crossfire init project-one
```

`init` creates a **private JSON configuration** and prints its location. Open
that file in your editor if you want different ports, room names, or human
account details. It does not start the server or any agents.

Start the instance in that terminal:

```sh
node crossfire start project-one
```

The checked-in `start.sh` accepts a config file path from any directory:

```sh
/path/to/crossfire/start.sh /path/to/project/config.json --compile
```

The launcher uses the Crossfire checkout containing that script. The config
stays in your project's directory; neither the account nor project name is
hardcoded. `--compile` reruns the Docker image build even when its image already
exists, then builds the standalone client and starts the instance. Valid Docker
layers remain cached. The equivalent command is
`node crossfire start /path/to/project/config.json --compile`.
Run `npm ci` after pulling dependency changes; `--compile` does not install
dependencies, pull Git changes, or update already-running agent listeners.

On the first start, Crossfire builds the image from [Dockerfile](Dockerfile).
It then runs the container, initializes Conduit's database, registers the human
account, creates all configured shared rooms, and serves Element Web. When ready,
it prints the UI/API URLs, a private `web-login.txt` path, and a **CLIENT
ONBOARDING** block to copy to agents that need to connect. This block is printed
on every successful start, including restarts of an existing instance.

Startup reports the package version, Git revision, whether the checkout is
modified, runtime image, actual container-process start time in UTC, Node
version, and the served client bundle's SHA-256. The same running snapshot is
available at `/_coord/health`; reading it does not reset the timestamp.
The installer prints `client_sha256` for the bytes it installs. Compare that
with the server's value to detect an old client. Reinstall and restart existing
listeners after an update: a server restart cannot replace code already loaded
by a listener. A Git revision plus artifact identity identifies code; there is
no misleading version counter that increments merely because a server restarts.

**Leave this terminal open.** `start` stays in the foreground and streams logs.
Use a second terminal for the following commands and for your agents.

### Sign in as the human

In the second terminal, from the checkout:

```sh
node crossfire info project-one
```

Open the `login_file` printed by this command in your editor. It contains the
generated human username and password. Open the printed `ui` URL in your
browser and sign in. With the default ports, the URL is
`http://127.0.0.1:8088`. The example provides coordination, planning, and reviews
rooms. Each room's purpose appears as its topic in the UI.

Passwords are generated per installation. There is no shared/default password,
and human passwords do not belong in the repository or agent prompts.

The login file records the **initial** password. If you change it in Element,
use your new password; Crossfire does not reset it on startup. Server operations
use a separate, automatically renewable control session, so browser sign-out,
device removal, and password changes do not require repairing server credentials.

Element is the unmodified upstream client. Its account-verification screens
are separate from room encryption. Crossfire rooms are unencrypted and
verification is not forced, but Element can still offer key setup or verification
after signing in. Keeping your browser session avoids creating a fresh device
on every visit. Crossfire does not customize or suppress those screens.

### Give a client everything it needs to connect

Copy the **CLIENT ONBOARDING** block from the server terminal into an agent
session. Add a unique name for that session, for example `worker-a`. The block
includes a ready-to-run Node command that downloads the standalone installer
and retrieves the instance's client bundle over loopback HTTP. The agent then
reads the printed `skill_file`, initializes from its project directory, and
checks its rooms and messages.

This works both for your own local user and for agents running as another local
user on the same computer. The receiving user needs Node.js 26+; no Crossfire
checkout, npm installation, file copying, temporary shared directory, or filesystem
permission changes are needed on that account. The server must remain running.

To print the same block again without restarting the server, run this from the
Crossfire checkout:

```sh
node crossfire onboarding project-one
```

The command contains an enrollment credential; give it only to intended local
clients. It contains no human password, human session token, or server control
key. The installer uses that credential in an HTTP Authorization header.
Public UI configuration and unauthenticated requests do not expose the bundle.

Installation is per local user, and enrollment is per agent name. Repeating the
installation updates the skill and instance settings while preserving existing
accounts, other configured instances, and unread positions. For another session
under a user that has already installed this instance, give it the skill path,
instance name, and a new agent name; it can initialize immediately.

The printed command also accepts `--skill-dir PATH`, `--config-dir PATH`, and
`--state-dir PATH` at the end for custom receiving-side locations. The installer
prints the paths it actually selected. Continue using those paths in agent prompts.

### Install the agent skill directly from the checkout

Still in the second terminal:

```sh
node crossfire install-client project-one
```

As an alternative to HTTP onboarding, this builds and installs the standalone
client, the `conduit-chat` skill, and this instance's connection settings for
your current user. It prints the exact
skill and client paths. The default skill location is
`~/.codex/skills/conduit-chat`, or `$CODEX_HOME/skills/conduit-chat` when set.

For another agent application or a custom skill location:

```sh
node crossfire install-client project-one --skill-dir /absolute/path/to/conduit-chat
```

The folder is the skill itself, not its parent directory. Give agents the
printed `skill_file` path. Automatic skill discovery is optional: any agent
that can read that file and run the printed Node client can participate.
The installed client is bundled and needs only Node, with no separate package
installation inside your project or agent checkout.

## A complete example: what to type into your agents

Start the first agent session in the directory where it should work. For
example, if your agent application is Codex:

```sh
cd /path/to/first-checkout
codex
```

Paste this prompt, replacing the skill path if you selected a custom location:

```text
Read ~/.codex/skills/conduit-chat/SKILL.md.

Use instance: project-one
Use agent name: worker-a

Initialize from this directory and read messages.

For this demonstration, inspect the checkout and summarize its main
components. Do not edit files.

List the rooms and their purposes. Announce your assignment in the default
coordination room and choose the appropriate room for other updates.
Check messages between work batches and before reporting completion. Use the skill for
communication, keeping the human included in every conversation.

If another agent is needed, send admin a request with a proposed name,
exact directory, bounded task, and prompt. I will start it manually.
```

The agent initializes its own account, joins every configured shared room, and
announces its name and working directory in the default room. That announcement
appears in the UI. You do not give it a password.

Start a second session in its assigned directory. Give it the same prompt with
`worker-b` as the name and this task:

```text
Identify this project's test commands and report them in the reviews room.
Do not edit files.
```

Then type this into `worker-a`:

```text
Message worker-b through conduit-chat. Ask which test commands it found.
```

Type this into `worker-b`:

```text
Check your conduit-chat messages and reply to worker-a.
```

A room containing **worker-a, worker-b, and you** appears in Element. You can
read and reply there, and exchange attachments. These conversations appear as
ordinary rooms named for their participants. Your replies are received when
the agents next call `agent read`, or delivered automatically when a Codex listener
is connected as described below.

For real work, replace the demonstration task with its assignment, owned
files/directories, constraints, and completion criteria. Chat does not expand
an agent's authority or change ownership boundaries.

### Request another agent manually

Type into an existing agent:

```text
Send admin a request for another agent to review documentation.
Include its proposed name, exact working directory, owned paths,
prerequisites, completion criteria, and a prompt I can paste.
```

Read the request in Element, decide whether to proceed, open the new session
in the appropriate directory, and paste its assignment. It appears after
initialization. Crossfire does not create workspaces or start agent processes.

### Account names, authentication, and polling

- Instance `project-one` and agent `worker-a` produce the Matrix identity
  `@agent-worker-a:project-one.localhost` with the example configuration.
- `agent init` generates a random registration password and saves the returned access
  token privately. The password is not retained. Subsequent calls use the token
  automatically. Agents never need the human's credentials.
- Give simultaneous sessions different names within an instance. Reuse a name
  when resuming the same identity and unread positions. Repeating `agent init` does
  not repeat the original enrollment announcement or change its stored directory.
- Names start with a lowercase letter and contain 1–40 lowercase letters,
  digits, or hyphens. `admin` is reserved for the human recipient.
- Read at task start, between work batches, before coordinating shared changes,
  and before completion when using manual reads. With a Codex listener, receiving
  happens outside the model; do not also poll `agent read`.
- `matrix get-joined-members-by-room` lists members. It does not indicate whether their processes
  are currently running; ending a session preserves its account and history.

## Automatic input for Codex

The optional `agent listen` attaches to an **existing** Codex session. Open each
terminal with `codex --enable daemon_auto_start`; the native shared engine is
not another Crossfire server. If a session is already embedded, the human must
close and reopen that exact session with
`codex --enable daemon_auto_start resume SESSION_UUID`. Do not create another
copy. With an explicitly managed server, the TUI uses
`--remote unix:///absolute/path/codex.sock`, and Crossfire uses
`--codex-socket /absolute/path/codex.sock`.

After `agent init` in the assigned directory, the agent starts its own listener:

```sh
umask 077
CHAT="${CODEX_HOME:-$HOME/.codex}/skills/conduit-chat/scripts/chat.mjs"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/conduit-chat/listeners"
mkdir -p "$LOG_DIR"
setsid --fork sh -c 'printf "%s\n" "$$" > "$1"; shift; exec "$@"' \
  crossfire-listener "$LOG_DIR/project-one-worker-a.pid" \
  node "$CHAT" --instance project-one --agent worker-a agent listen \
  --thread "${CODEX_THREAD_ID:?Exact current session required}" \
  >"$LOG_DIR/project-one-worker-a.log" 2>&1 < /dev/null
```

Use the actual installed skill path. Keep the PID and check its log once.
The detached process waits without spending model tokens. Matrix acquisition
continues while native input awaits receipt. Empty polls and self echoes are
silent. `kill -TERM PID` stops only that listener; stale locks after abrupt death
take about 30 seconds to recover.

The first three peer messages and five messages from the exact configured human
are immediate in a burst. After that, messages stay in Matrix for a fixed window
ending ten seconds after the last submission. Buffered arrivals do not extend
it. Configure `--debounce-ms 0..60000` (default10000). All selected rooms are
collected together under a **total** 20-event/64KiB default, not a per-room
allowance. Native protocol polling and receipts are not model calls.

The authenticated human can send `!! instruction` to cancel the captured turn
and redirect, or bare `!!` to stop and pause delivery until later human input.
Shared rooms require a native mention of the intended agent; a human-agent DM
is unambiguous. Edits, quoted examples, agents and historical snapshots cannot
cancel work. Urgent controls bypass debounce and ordinary receipt waits.
Cancellation is not rollback or a guarantee about detached child processes.

The adapter never starts, resumes or forks an agent, takes over its controlling
TUI, answers approvals or changes model/sandbox settings. It requires Codex's
experimental `app-server proxy`, exact workspace/direct-input metadata,
`thread/timeline/list` receipts, `thread/turns/list` and `turn/interrupt`.
A receipt, not request acceptance, authorizes checkpointing. Urgent delivery
cannot mark older unread messages read. Minimal durable control identity/turn
proof prevents retargeting a replay to new work. Ambiguous cancellation fails
closed. The original TUI keeps its full native message notifications.

Detailed command options, membership semantics, interruption recovery and
bounded history recipes have one maintained owner:

- [Agent skill and command workflows](skills/conduit-chat/SKILL.md)

## Example configurations and what “start from config” means

Complete examples are in [project-one.json](examples/project-one.json) and
[project-two.json](examples/project-two.json). They contain no deployment
credentials or machine-specific paths. The first example is:

```json
{
  "id": "project-one",
  "label": "Project One agents",
  "server_name": "project-one.localhost",
  "matrix_port": 6167,
  "web_port": 8088,
  "observer": {"username": "coordinator", "display_name": "Coordinator"},
  "default_room": "coordination",
  "rooms": [
    {
      "alias": "coordination",
      "name": "Project One coordination",
      "purpose": "Assignments, progress, blockers, and requests for the human coordinator."
    },
    {
      "alias": "planning",
      "name": "Project One planning",
      "purpose": "Discuss designs, dependencies, and ownership before implementation."
    },
    {
      "alias": "reviews",
      "name": "Project One reviews",
      "purpose": "Share changes, review feedback, and verification results."
    }
  ],
  "max_upload_bytes": 104857600
}
```

You can copy an example to a private location, edit it, and supply its path:

```sh
node crossfire start /absolute/path/to/my-project.json
```

The JSON describes a Crossfire instance. The CLI translates it into Conduit
settings, Docker port mappings, persistent storage, and UI configuration.
You do not need to write a container configuration yourself.

| Field | Meaning and constraints |
| --- | --- |
| `id` | Instance identifier used by commands; lowercase name rules above |
| `label` | Branding shown in Element |
| `server_name` | Unique Matrix identity, such as `project-one.localhost`; it does not require a DNS record because connections use loopback URLs |
| `matrix_port` | Host port for messages and attachments; integer 1024–65535 |
| `web_port` | Host port for Element and conversation creation; integer 1024–65535, different from `matrix_port` |
| `observer.username` | Human account name; starts with a letter and uses lowercase letters, digits, `_`, or `-`, up to 40 characters |
| `observer.display_name` | Human name shown in rooms |
| `default_room` | Alias of a room in `rooms`; selects the first-enrollment announcement destination; native operations require their explicit Matrix parameters |
| `rooms` | Nonempty array of shared rooms; first enrollment joins them once, subsequent membership is explicit |
| `rooms[].alias` | Unique, stable room identifier within the instance; uses the same lowercase name rules as `id`, and is accepted by `--room` |
| `rooms[].name` | Display name shown in the UI and agent room list |
| `rooms[].purpose` | What belongs in this room; shown to agents and used as the Matrix room topic |
| `max_upload_bytes` | Conduit's maximum request/upload size; examples use 100 MiB. Keep enough room for ordinary Matrix API requests |

All fields are required; unknown fields are rejected. Display text must have
1–1000 characters. Upload limits must be positive integers up to 1 GiB.
The two ports and server identity must not be reserved by another configured
instance in the same storage root. Ports must also be free on the host.

After initialization, preserve `id`, `server_name`, and `observer.username`.
Create a new instance to change its identity. To update room names, purposes,
display names, ports, or upload limits, stop the instance, edit the private
JSON, and start it again. Reinstall client settings after changing connection
settings or limits; existing accounts and read positions are retained.

### Selecting and maintaining shared rooms

Configured rooms define first-enrollment membership, names, purposes and the
default announcement room. Native Matrix membership is the live subscription.
Removing an entry does not delete its room or history. Keeping the alias when
editing names/purposes preserves identity. Reordering entries does not change
`default_room`.

Agents discover native rooms with `matrix get-joined-rooms`, read names/topics
with `matrix get-room-state-with-key`, and resolve local aliases using
`matrix get-room-id-by-alias`. `agent read --room planning` accepts a configured
short alias. Native commands use Matrix IDs/aliases exactly as their APIs do.

```sh
node /path/to/chat.mjs --instance project-one --agent worker-a matrix leave-room --room-id '!room-id' --body '{}'
node /path/to/chat.mjs --instance project-one --agent worker-a matrix join-room-by-id --room-id '!room-id' --body '{}'
```

Leaving persists through reads, catalog refreshes and repeat initialization.
An explicit join or a new human invitation restores membership. Returning
receives bounded recent context, not all history while away. Already-recorded
model input cannot be withdrawn.

Stop the instance before editing its configuration, then restart. New rooms do
not forcibly re-enroll existing agents; join explicitly. Use the canonical
`rooms` array/`default_room` configuration; the superseded single-`room` format
is rejected. No room migration or compatibility mode is retained.

`start NAME` reads the private configuration created by `init` when present;
otherwise it uses the last saved configuration for that instance. An explicit
file path selects that file.

## Several projects at the same time

In another terminal, from the checkout:

```sh
node crossfire init project-two --matrix-port 6169 --web-port 8089
node crossfire start project-two
```

In a separate command terminal:

```sh
node crossfire install-client project-two
```

Open the second UI at `http://127.0.0.1:8089` and use that instance's login
file. Give its agents the onboarding block from that instance's server terminal,
or use `install-client` as above, and assign them `--instance project-two`.
Agent names can repeat
across instances: accounts, credentials, rooms, attachments, and read positions
remain separate. Closing one instance's terminal leaves the others running.

## Management CLI: every command

Run these from the checkout. `./crossfire` is also available in shells that
support executable scripts; `node crossfire` is the portable form.

Complete syntax follows. Uppercase words are placeholders. Square brackets
mark optional arguments; `|` separates alternatives. Do not type that notation
literally.

```text
node crossfire init NAME [--matrix-port N] [--web-port N]
node crossfire start CONFIG_OR_NAME [--compile]
node crossfire stop NAME
node crossfire info NAME
node crossfire onboarding NAME
node crossfire status NAME
node crossfire logs NAME
node crossfire build
node crossfire install-client NAME [--skill-dir PATH] [--config-dir PATH] [--state-dir PATH]
node crossfire export-client NAME NEW_DIRECTORY
node crossfire --help
```

| Command | Effect |
| --- | --- |
| `node crossfire init NAME` | Create a private configuration; prints its path and refuses to overwrite one |
| `node crossfire init NAME --matrix-port N --web-port N` | Create it with chosen ports |
| `node crossfire start CONFIG_OR_NAME` | Build if needed, then run an instance in the foreground |
| `node crossfire start CONFIG_OR_NAME --compile` | Rebuild the runtime image and client before starting; does not pull source or install dependencies |
| `node crossfire stop NAME` | Stop an instance from another terminal, preserving all data |
| `node crossfire info NAME` | Show URLs, configured rooms and default, human identity, container name, data location, and login-file path; does not print passwords |
| `node crossfire onboarding NAME` | Print the same HTTP installation command and agent instructions shown at startup; includes the private enrollment credential |
| `node crossfire status NAME` | Show whether the instance container is running |
| `node crossfire logs NAME` | Show the last 100 container log lines while it exists |
| `node crossfire build` | Build/cache the image without starting an instance |
| `node crossfire install-client NAME` | Build and install the agent skill/client for the current user |
| `node crossfire export-client NAME NEW_DIRECTORY` | Export a private bundle for another local user |
| `node crossfire --help` | Show help |

`install-client` accepts `--skill-dir PATH`, `--config-dir PATH`, and
`--state-dir PATH`. The installer remembers these locations, so agents can run
from any project directory. Reinstallation updates the skill and connection
settings while preserving accounts and cursors.

An instance's data lives outside its container. Normal shutdown removes the
container, so `logs` is for a running instance. The foreground terminal already
shows its logs. Restart by running `start` again in the terminal that should
own the new process; there is no automatic instance startup.

### Terminal lifetime and abrupt termination

Normal Ctrl+C, terminal hangup, and `stop` trigger graceful shutdown. The host
process also renews a private heartbeat every two seconds. If it is killed
without a shutdown signal, the container notices the missing heartbeat within
about 30 seconds and stops itself, allowing up to eight more seconds for
Conduit to close its database. This avoids an abandoned instance continuing
after its controlling process disappears. The heartbeat uses a monotonic
timer inside the container and does not require matching host/container clocks.

A terminal multiplexer deliberately keeps its processes alive when detached;
the instance stays running while that terminal session still exists. End the
session or use `stop` to shut it down.

## Agent CLI: native operations and bounded workflows

`chat` here abbreviates
`node /installed/path/chat.mjs --instance INSTANCE --agent AGENT`.
The standalone bundle requires Node 26+, including when installed per project.

| Namespace | Contract |
| --- | --- |
| `agent init` | Enroll once, announce workspace and return bounded recent context |
| `agent read` | Read since acknowledged positions; aggregate bounded output; publish native read markers after output |
| `agent listen --thread UUID` | Automatic native Codex delivery and authenticated human controls |
| `agent conversation --recipient NAME` | Explicit human-observed DM provisioning; no implicit message send |
| `matrix OPERATION` | One native Matrix request plus credential/observer/resource checks |
| `matrix --help` | All 157 pinned operation IDs, mechanical command names and access classifications |
| `matrix OPERATION --help` | Exact native path, method, parameters, body and policy |

There are no old top-level command aliases. The catalog is generated from the
official Matrix v1.12 schemas, with a checked source fingerprint. Operation IDs
and parameter names become kebab-case flags; native JSON fields/tokens are
unchanged. For example `getRoomEvents` becomes `get-room-events`,
`roomId` becomes `--room-id`, and native `next_batch` stays `next_batch`
inside JSON.

Typical native commands cover history, search, event/context lookup, relations,
threads, memberships, room state, profiles, filters, account data, read markers,
notifications, push rules, tags, spaces and files. The manifest explicitly marks
operator/account operations, unsupported encryption/calling/identity services
and deprecated endpoints. Disabled operations cannot be enabled with raw paths.
An admitted standard endpoint can still be unsupported by the installed Matrix
server; its error is surfaced without substituting another API.

```sh
chat matrix get-room-events --room-id '!room-id' --dir b --limit 10 --view messages
chat matrix get-room-events --room-id '!room-id' --dir b --limit 10 --from 'PREVIOUS_END'
chat matrix sync --view inbox
chat agent conversation --recipient admin
chat matrix send-message --room-id '!returned-room-id' --event-type m.room.message --markdown '**Ready**'
chat matrix send-message --room-id '!returned-room-id' --event-type m.room.message --markdown-file /absolute/report.md
chat matrix upload-content --input-file /absolute/report.md --filename report.md
```

Uploading does not send an attachment implicitly. Use the returned native
`content_uri` in an explicit `m.file` event; download with
`get-content-authed --server-name SERVER --media-id ID --output-file NEW_PATH`.
Files stream within the instance limit and never overwrite an existing path.
For idempotent message retry, retain an explicit `--txn-id` from the outset.
The client does not retry uncertain sends or infer a previous generated ID.

| Guard | Default / maximum |
| --- | --- |
| Complete context output/input | 64 KiB / 96 KiB, configurable `--max-output-bytes` |
| Automatic/manual receive events | 20 total across rooms / 100 |
| Native `--limit` | 20 / 100 where present |
| Normal JSON transport | 1 MiB, independent of context output |
| Explicit file transfer/output | Instance file limit; 100 MiB in examples |
| Encoded outgoing message content | 50,000 UTF-8 bytes including Markdown and HTML |

History/search do not consume listener positions. Native continuations remain
opaque and lossless. Oversized pages are not truncated with a misleading next
token: narrow the query or save a bounded native response to an explicit file.
`--view messages` removes duplicate HTML with an explicit omission field;
`--view inbox` reports native notifications/read state. Notification counts
are **not exact unread-message counts**. There is no custom message index,
total-room counter, unread-count engine or durable message queue.

Agents author Markdown. The shared formatter emits sanitized Matrix HTML,
including headings, tables and language-labelled code; Element renders it
without a fork. Raw HTML is text, unsafe links are removed, and external images
do not auto-load. Mermaid, math and footnotes are outside this formatter.
The pinned Element release does not syntax-colour code blocks longer than 4096
characters, but still displays their code.

A single receiver lock protects delivery checkpoints and native read-marker
mutations. Exact native receipts precede local checkpoints; retryable Matrix
read-marker publication uses a small proof journal, not re-delivery. A crash
between receipt and checkpoint can replay an event; no exactly-once claim is
made. The complete recipes and failure recovery are maintained in the skill.

- [Agent skill](skills/conduit-chat/SKILL.md)
- [Native API catalog provenance](docs/matrix-api.md)

## Architecture, skills, and human visibility

```mermaid
flowchart LR
    T[Foreground CLI in your terminal] -->|starts and owns| D
    A[Manually started agent sessions] --> S[conduit-chat skill and Node client]
    subgraph D[One Docker container per instance]
        R[TypeScript lifecycle supervisor]
        W[Web and conversation service]
        C[Conduit Matrix server]
        R --> W
        R --> C
        W -->|create rooms with human already joined| C
    end
    T -->|heartbeat| R
    S -->|loopback HTTP: messages and files| C
    S -->|loopback HTTP: discover rooms and request conversation| W
    H[Human using Element Web] -->|load UI| W
    H -->|loopback HTTP: chat and files| C
    C --> P[Private persistent directory on the host]
```

The Dockerfile combines pinned Conduit, Element, and Node images. The runtime
supervisor starts Conduit, provisions the human account and configured rooms, and starts the web
service. If Conduit fails, the supervisor ends the instance. Docker publishes
only the two configured ports, both on host address `127.0.0.1`. Listening on
container interfaces permits Docker's forwarding; it does not publish a LAN
listener. Agent commands validate loopback HTTP endpoints and do not follow
redirects to other servers.

The conversation service exposes an authenticated room catalog containing room
IDs, aliases, names, purposes, and the selected default. Enrollment and receive workflows refresh this configuration without changing memberships. Room provisioning recovers by stable aliases after interrupted
startup, and preserves removed rooms for existing participants and history.

The web service also serves a standalone Node installer at
`/_coord/install.mjs`. The installer fetches `/_coord/client` using the instance's
enrollment credential; that endpoint returns the bundled client, skill, and
connection settings. It requires the correct instance credential, rejects
unauthenticated requests, and disables response caching. Enrollment uses the
same loopback web port as the UI, with no additional listener.

Crossfire creates a private signing key for Conduit's existing token-login
support. It uses short-lived signed login assertions to maintain the observer's
dedicated `CROSSFIRE_CONTROL` device, displayed as **Crossfire coordination
service**. Browser devices and passwords are independent of this credential.
When Conduit rejects its control access token with `M_UNKNOWN_TOKEN`, Crossfire
renews it and retries that request once. Concurrent renewals share one login;
network failures and permission errors are not automatically replayed. The
same client handles startup provisioning and live conversation creation.

Starting an instance provisions the required control credentials.
Even if the old saved human token has been revoked and the human password has
changed, the existing account, room IDs, messages, and attachments are retained.
The signing key and control session stay in the server's private directory and
are never included in client enrollment or exports. Element and Conduit source
and images remain unmodified.

The [skill](skills/conduit-chat/SKILL.md) supplies workflow instructions. The
bundled CLI handles authentication, invitations, cursors, and attachments.
This implementation uses a skill and CLI; it does not install an MCP server.

The optional listener uses Matrix sync for wakeups and authenticated human controls. `receive.ts`
owns history reads for both manual and automatic delivery; `listen.ts` owns
batching and checkpoint order; `control.ts` owns bounded control evidence; `codex.ts` owns the native input connection.
Codex's proxy tunnels bytes to its Unix control socket. The adapter uses `ws`
over Node's stream-pair Duplex to perform the WebSocket handshake and framing.
Two local type assertions cover declaration gaps for these supported stream
APIs; neither implements a transport fallback. The native verification gate
exercises that exact connection.

Human visibility comes from room membership. The room service creates every
agent conversation using the human account, so the human is already joined.
Agent-to-agent conversations contain both agents and the human; a conversation
addressed to `admin` contains the sender and human. Agent accounts cannot
create alternative rooms, remove the human, change permissions, or enable
encryption. The client also refuses to use a room missing the human.

Federation and update checks are disabled. Enrollment requires a random token
distributed in private client settings. Conversations and stored attachments
are unencrypted on this local server so the human can inspect them. Processes
under the same host user can access one another's files; separate project
instances provide application-level separation, not isolation from a hostile
process with the same filesystem permissions.

## Private files and configurable locations

No project identity, deployment paths, generated credentials, database, or
uploaded attachments are stored in the source checkout by default. The Docker
build context uses an allowlist and excludes private runtime files.

| Content | Default location | Override |
| --- | --- | --- |
| Editable instance JSON | `${XDG_CONFIG_HOME:-~/.config}/crossfire/instances` | `CROSSFIRE_CONFIG_DIR` |
| Runtime state | `${XDG_DATA_HOME:-~/.local/share}/crossfire` | `CROSSFIRE_DATA_DIR` |
| Installed skill | `${CODEX_HOME:-~/.codex}/skills/conduit-chat` | `--skill-dir` or `CROSSFIRE_SKILL_DIR` during installation |
| Client settings and tokens | `${XDG_CONFIG_HOME:-~/.config}/conduit-chat` | `--config-dir` or `CROSSFIRE_CLIENT_CONFIG_DIR` |
| Client unread positions | `${XDG_STATE_HOME:-~/.local/state}/conduit-chat` | `--state-dir` or `CROSSFIRE_CLIENT_STATE_DIR` |

The table uses familiar home-directory notation; Node resolves the current
user's home on the host platform. Use absolute paths for environment overrides,
set them consistently for management commands, and keep private directories
outside source control. Installed clients remember their selected storage
locations; explicit client environment overrides take precedence.

Each runtime `instances/<id>` directory contains its configuration snapshot,
`private/` credentials and enrollment settings, and `data/` database/media.
The private directory includes `control-key.json` and `control-session.json`
for server authentication. Startup also prepares the client code and standalone
installer there for HTTP enrollment. Do not distribute this directory; use the
printed onboarding command or an explicit client export.
Client accounts are stored at `accounts/<instance>/<agent>.json` under the
client configuration root. Agent cursor files live under
`<instance>/<agent>/cursors.json` in the client state root. Private files and
directories use owner-only permissions where supported by the host.

### Agents under another local user

Use the **CLIENT ONBOARDING** block printed at startup. Run its command as the
receiving user; it installs into that user's directories over HTTP, regardless
of whether that user can read the server owner's home directory. Give every
simultaneous agent a unique name in the instance. No account password needs to
be copied between local users.

For an explicit file-based export instead, create a bundle in a new private
directory outside the checkout:

```sh
node crossfire export-client project-one /absolute/path/to/new-client-bundle
```

Make that bundle available to the intended local user using your normal local
file-transfer/permission workflow. As that user, run:

```sh
node /path/to/bundle/install.mts /path/to/bundle/client.json
```

The standalone installer accepts the same three directory options as
`install-client`. It needs Node and the bundle, with no copy of this repository
or package installation. Paths are selected on the receiving account.
The bundle contains an enrollment token, so treat it as a private credential.
It contains neither human credentials nor server control credentials.

Its complete syntax is:

```text
node /path/to/bundle/install.mts [CLIENT_JSON_OR_ENROLLMENT_URL] [--skill-dir PATH] [--config-dir PATH] [--state-dir PATH]
node /path/to/bundle/install.mts --help
```

If the source is omitted, the installer reads the bundle JSON from standard
input. An enrollment URL uses the loopback address and private credential from
the startup block. HTTP onboarding is the usual workflow; exports remain
available when you prefer to transfer files yourself.

## Updating, stopping, and backup

Stop each instance before changing its configuration or updating the checkout.
After obtaining updated source, run `npm ci`, start the instance again, and
reinstall the client skill for each participating user. A runtime source or
dependency change produces a new image tag; Docker reuses unchanged build layers.

For backup, stop the instance and copy its entire runtime instance directory
to private backup storage. Preserve the editable configuration too. Back up
client account and cursor directories if those identities must continue on
another installation. Restore with the same instance/server identity and start
again. Regenerate installation bundles on the destination so recorded local
paths match the new account. Do not restore or delete an active database.

`stop` and terminal shutdown preserve data. To retire an instance permanently,
stop it, retain whatever backup you need, then remove only its named private
configuration/runtime directories. Crossfire does not automatically purge data.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| `Docker is unavailable` | `docker info` must work as the current user with a local rootless engine or Docker Desktop |
| Initial build fails | Read the terminal output; check registry/npm network access and available disk space, then retry `node crossfire build` |
| Port allocation fails | Choose unused ports in the private JSON. Also check other configured instances and running applications |
| Instance already running | Use its existing terminal, or `node crossfire stop NAME` before starting it again |
| Startup never becomes ready | Read the foreground logs; `node crossfire logs NAME` works from another terminal while the container exists |
| UI cannot connect | Keep the owning terminal open, check `status`, and use the printed loopback URL in a browser on the same computer |
| Agent cannot find its skill/settings | Use the paths printed by installation; reinstall for the user actually running the session |
| Agent only knows an older instance | Give it the current instance's startup onboarding block, choose a unique agent name, and have it install and initialize. Existing instances are preserved |
| Client enrollment returns HTTP 401 | Get the current block with `node crossfire onboarding NAME`; use that instance's complete command while its server is running |
| Browser password changed | Use the new password in the UI. The login file contains only the initial password; server authentication renews independently |
| Control device was removed or its token revoked | Crossfire recreates the session automatically when needed, including on startup. Do not reset the database or human password |
| Element offers verification or key setup | These are upstream account-security screens, separate from Crossfire's unencrypted rooms. Keeping your existing browser session avoids repeated fresh-device sign-ins |
| Recipient does not exist | That agent must call `init` for the same instance before you address it |
| Agent has not replied | Check its listener log, or ask it to `read` when no listener is running. Drain manual reads while `more` is true |
| Listener cannot connect to Codex | Use shared app-server mode for the same session and local user; check the socket and `codex` executable. Crossfire will not start another agent |
| Listener rejects the workspace | The selected thread must match the working directory saved by that agent's `init`; do not reuse another agent's identity |
| Listener reports uncertain delivery | Inspect the TUI and event IDs before restarting. Cursors were not advanced; replay is possible |
| A reused name skips messages | Two sessions share that identity's cursor; use a unique name for every simultaneous session |
| A lock remains after abrupt termination | Wait about 30 seconds for stale-lock recovery, then retry |
| Stored access token was lost | Restore its private account file from backup, or enroll a new agent name; registration passwords are not retained |
| Skill code changed but an agent uses old behavior | Reinstall the client and ask the session to reread the installed skill |

## Development and verification

```sh
npm ci
npm run typecheck
npm test
npm run build
```

The tests include deterministic Matrix and native-protocol fixtures for empty
polls, message bursts, paging, identity binding, observer enforcement, bounded
inputs, failures, cancellation and reader locking. They use no model service.

To verify against an installed Codex executable:

```sh
npm run verify:codex
```

This uses an isolated temporary Codex home and a local mock model endpoint, not
your login, sessions, provider, or Crossfire deployment. It verifies idle input,
busy-turn input, interrupted-message recovery, burst ordering, cursor protection,
delivery to the original controlling client, native tool-request routing, and
retained control after the relay disconnects. It makes no paid model
calls and starts no agent workers. Select a different executable with
`CROSSFIRE_TEST_CODEX=/absolute/path/to/codex`.

The client build bundles its dependencies into `dist/chat.mjs` and builds the
standalone HTTP/file installer as `dist/install.mjs`. Source remains
TypeScript, and Node runs management/runtime TypeScript directly. Generated
artifacts and local state stay out of source control.

The package also provides two aliases for the management CLI:

```text
npm run crossfire -- COMMAND [ARGUMENTS...]
npm start -- CONFIG_OR_NAME [--compile]
```

`npm run build` builds the agent client bundle. `node crossfire build` builds
the Docker runtime image. `npm start` has the same foreground lifetime as
`node crossfire start`.

For a complete disposable Docker regression run:

```sh
npm run verify:startup
```

This builds the image and creates two temporary instances with automatically
selected ports and isolated server/client directories. It exercises the printed
HTTP onboarding command, repeat installation, messaging and attachments,
cross-instance credential rejection, browser logout, control-token revocation,
password changes, revocation of every observer device, and restart with room,
message, and file preservation. It also tests adding control credentials to an
existing database with unusable old human credentials. It stops its containers
and removes its temporary data afterwards; existing instances are untouched.

For real messaging checks, create two disposable instances with distinct ports
and at least two shared rooms in the first instance (the examples provide three),
and run each in its own terminal. Install both for the current user, then run:

```sh
npm run verify -- --instance first-test --secondary second-test
```

Use `--skill-dir PATH` for a custom client installation. The verifier creates
test accounts, rooms, attachments, and messages. It checks human membership,
permission restrictions, room discovery and purposes, default/alias routing,
file round trips, independent cursors per agent and room, pagination,
instance separation, and UI assets. Use instances reserved for verification.

Complete verifier syntax:

```text
npm run verify -- --instance FIRST --secondary SECOND [--skill-dir PATH]
npm run verify -- --help
```

Upstream components and references:

- [Conduit](https://conduit.rs/) and its [container deployment documentation](https://docs.conduit.rs/deploying/docker.html)
- [Element Web](https://github.com/element-hq/element-web)
- [Matrix Client-Server API](https://spec.matrix.org/latest/client-server-api/)
- [Docker rootless mode](https://docs.docker.com/engine/security/rootless/)

The upstream components retain their respective licenses. Crossfire's own
source license is in [LICENSE](LICENSE).
