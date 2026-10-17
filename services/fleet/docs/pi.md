# Earendil Pi

## Supported integration

The admitted native executable is `@earendil-works/pi-coding-agent@1.0.0`.
It must be available as `pi` on the controller's PATH.
Other versions fail until their actual RPC behavior is verified.
Setup does not install or silently upgrade the runtime.

```sh
npm install --prefix /absolute/private/pi-install @earendil-works/pi-coding-agent@1.0.0
export PATH="/absolute/private/pi-install/node_modules/.bin:$PATH"
pi --version
```

Configure provider login through native Pi on that host.
The source home is `PI_CODING_AGENT_DIR`, otherwise native `~/.pi/agent`.
Never send provider secrets through Matrix.

## Definition

```toml
name = "Research analyst"
runtime = "pi"

[runtime_options]
provider = "EXACT_NATIVE_PROVIDER"
model = "EXACT_AVAILABLE_MODEL"
thinking_level = "high"
```

Provider/model must be supplied together or both omitted.
Omitted fields use verified native selection.
Thinking levels are off, minimal, low, medium, high, xhigh and max, subject to
actual available-model/available-level responses. Effective selections are checked
after setting; silent clamping is rejected.

Per-instance overrides use the common top-level replacement resolver.
Inspection, startup, resume, recovery and reset validate the same effective values.

Pi rejects Codex sandbox, approval, bypass and effort options.
Its tools run with the controller user's privileges; owner questions are not an
emulated filesystem/network sandbox.

## State and instructions

Private `.pi` owns copied auth/models files, exact format-3 native histories,
the context registry, receipt journals and the owned extension.
Every activation refreshes validated host auth/models files; an absent source
removes stale copies. Running engines are not hot-switched.

Native SessionManager initializes an allocated empty private history file.
Native appendEntry records verified instructions with zero model turns.
Established file/session/workspace bindings cannot be replaced silently.
Discovery is read-only; reset archives exact files.

Shared history is default. Per-room opens a native RPC process/file for each
retained active room plus a private control context. These share one agent,
identity, workarea and receiver. They do not isolate tools/files/credentials.

## Delivery and steering

A durable common journal precedes native publication.
Receipt requires exact custom correlation plus the persisted user entry on the
active native branch. A successful command response alone is insufficient.
Proven bytes are flushed before unread advancement.

Busy input remains in the common journal, not a hidden native queue.
Accepted mentions capture the current run, abort that exact generation and wait
for native idle before replacement input. Stale captures cannot interrupt a new
run/process. Deliberate interruption cancels its question without reporting a crash.

Unknown receipt after restart uses the common exact-message file and restart
instruction. It states uncertainty and prohibits repeating completed effects;
it does not promise exactly-once external execution.

## Questions and output

The owned extension is loaded explicitly. Automatic native extensions, skills,
templates and themes are disabled. Instructions come from the role/admin/skill
producer, not global installation.

The model's `crossfire_question` tool accepts:

```json
{"title":"Select approach","prompt":"Which report?","options":["Brief","Detailed","Cancel"]}
```

Omit options for free text. Native confirm/select/input/editor requests use the
same owner-decision port. Only explicit verified owner answers resolve the exact
request. No reply, expiry or interruption grants permission.
Secret answers and arbitrary stdin prompt scraping are not provided by this tool.

Text and visible tool-result output goes to the owner's DM.
Thinking and tool-call arguments are excluded. Room replies still require the
intentional messaging tool.

## Observations and limits

Management exposes native version/provider/model/thinking and activity.
Usage uses one cumulative baseline plus incremental native events.
Unavailable reasoning splits and trusted provider spend remain null.

Pi RPC does not expose live TUI attachment to an existing engine.
`fleet agent attach` returns unsupported; launching `pi --session` would be
another writer, not an attachment.

Orderly shutdown/interruption and idle crash recovery have test coverage.
SIGKILL during a detached tool can leave that tool alive. Linux inert-provider
coverage does not certify every provider/model or another platform.

- [Common session controls](sessions.md)
- [Explicit provider acceptance](https://github.com/control-flow-project/ctlflow/blob/main/services/fleetd/node/tools/README.md)
- [Runtime contract](https://github.com/control-flow-project/ctlflow/blob/main/services/crossfire/docs/runtime.md)
