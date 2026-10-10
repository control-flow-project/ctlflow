# Earendil Pi runtime

## Scope and prerequisites

Pi uses the same fleet setup, enrollment, listener, Matrix permissions, message
files, unread positions, sleep, owner decisions and stop/resume/reset operations
as Codex. Only the native adapter differs. There is no standalone agent mode,
import of an existing coding conversation or second listener implementation.
Claude remains unimplemented.

The admitted executable is **@earendil-works/pi-coding-agent 1.0.0**. `pi` must be
available on the controller's PATH. Other versions fail admission until their
actual protocol is verified. Setup does not install or silently upgrade Pi.
Use an operator-approved native installation, for example in a private directory:

```sh
npm install --prefix /absolute/private/pi-install @earendil-works/pi-coding-agent@1.0.0
export PATH="/absolute/private/pi-install/node_modules/.bin:$PATH"
pi --version
```

Configure provider authentication on that host through Pi. The source home is
`PI_CODING_AGENT_DIR`, defaulting to the native `~/.pi/agent`. Do not submit keys,
OAuth tokens or provider configuration containing secrets through Matrix.
Native environment authentication remains available. Linux is verified with an
inert local provider and actual OpenAI inference through native
`openai-codex`, `gpt-6-luna`, `medium`. Live acceptance covers responses, file tools,
owner answers, hard interruption, saved-history resume, idle crash recovery and
per-room histories. This does not certify every provider/model. macOS ownership
primitives are admitted but have not been certified on hardware.

## Configuration

Put this in an ordinary definition's `agents/analyst/agent.toml`:

```toml
name = "Research analyst"
runtime = "pi"

[runtime_options]
provider = "YOUR_NATIVE_PROVIDER"
model = "YOUR_EXACT_NATIVE_MODEL"
thinking_level = "high"
```

Provider/model must be supplied together or both omitted. When omitted, native
available-model/default selection applies and is verified before readiness.
The adapter does not interpret provider aliases or substitute another model.

| Field | Values | Omitted |
| --- | --- | --- |
| `provider` | Exact native provider ID, 1–200 characters | Native selection |
| `model` | Exact native model ID, 1–200 characters | Native selection |
| `thinking_level` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` | Native selection |

Schema acceptance does not mean a model supports a level. Native
`get_available_models` and `get_available_thinking_levels` own admission.
Unsupported combinations fail before a model request. Effective selections are
verified after `set_model`/`set_thinking_level`; silent clamping is rejected.
Per-instance `[instances.runtime_options]` overrides use the same resolver as
Codex. Inspection, enrollment, first start, resume, recovery and explicit fresh
history all validate the same effective options.

Pi has no implemented Codex-style sandbox/approval policy. Unknown options,
including `sandbox_mode`, `approval_policy`, `model_reasoning_effort` and Codex's
bypass setting, are rejected. Pi tools execute with the controller user's normal
filesystem/network privileges. Owner questions are not a filesystem security
sandbox, and sending a prompt saying “ask permission” does not create one.

Definitions retain the same companion `AGENTS.md` and Crossfire coordination
options. An optional roster workspace is native cwd; private state remains in
the instance workarea. Use the normal `fleet setup --config /absolute/runtime.toml`
workflow and required owner enrollment approval.

## Histories and instructions

Private workarea `.pi` owns auth/models copies, the canonical context registry,
native format-3 history files, delivery journals and the adapter extension.
Each native activation recopies bounded, validated host `auth.json` and
`models.json`; absent files remove old copies. Already-running engines are not
hot-switched. Workspaces, native history and Matrix identities are not replaced.

The registry durably records an exact empty-file allocation. Stock native
SessionManager initializes that file and creates its session UUID. The adapter
uses native `appendEntry` to retain an exact effective-instruction receipt before
readiness. Startup and changed instruction publication make zero model calls and
do not add synthetic chat messages. Reopening an established context requires
its exact file, session UUID and workspace. Missing/corrupt history is an error,
not permission to create a replacement. Context discovery does not initialize
files or wake a process. Explicit fresh history archives old files and receipts.

Shared history is the default. Per-room mode retains a separate native file and
RPC process for each opened room and a private control context. These processes
still belong to one fleet agent, workarea, identity and shared receiver. Files,
tools and credentials remain shared: separate conversations are not isolation
from another context's filesystem. Fleet sleep/stop closes owned engines and
resumes saved identities later.

## Delivery and interruption

The common journal retains each exact message before publication. Native custom
metadata correlates its ID/text with the actual persisted native user entry.
Receipt requires the current native branch to include that entry. A successful
RPC command is not evidence that the model received a message. Proven receipt
is flushed before unread positions advance.

Normal busy delivery remains durable in the common journal. It is not placed in
a native follow-up/steering queue. An accepted mention captures the current run,
checks that exact generation inside Pi, aborts it immediately and waits for native
idle before publishing the replacement. A stale capture cannot abort a new run
or a restarted process. Cancellation closes the original owner question without
treating deliberate interruption as a native crash.

When restart cannot establish the last message was received, the common recovery
contract preserves its verbatim text in a private file and supplies a correlated
continuation explaining the uncertainty and prohibiting repetition of completed
actions. It does not claim the previous input was received or exactly-once
external side effects. Verified original receipts prevent duplicate delivery.
Native failures reach the owner and the shared fleet lifecycle owns recovery.
Failure diagnostics obey the shared 4,000-UTF-8-byte plain-text status contract,
without splitting characters or retaining control codes. Ordinary output is not
truncated to that diagnostic limit.

The short-lived mention admission can cancel a room's startup before readiness;
after readiness it does not own the engine's lifetime. A completed Matrix poll
cycle therefore cannot stop the resumed room or a subsequent task.

Orderly shutdown and hard interruption stop tested native shell-tool children.
An abrupt `SIGKILL` while a detached native tool is running can leave that tool
outside the dead process's lifetime. Crossfire does not claim arbitrary subprocess
containment or adopt orphaned processes. The Linux idle-process crash and exact
saved-history recovery are tested; this is not proof of every crash/tool case.

## Output and owner questions

Structured text and native tool-result text are mirrored only to the owner's
private DM. Thinking traces and tool-call arguments are not forwarded. Public
room replies still use intentional Crossfire tools and recipient permissions.
The adapter loads its own extension explicitly; automatic native extensions,
skills, templates and themes are disabled. Role/administrator/Crossfire skill
instructions use the verified native instruction input, not global installation.

The extension exposes `crossfire_question` to the model:

```json
{"title":"Select approach","prompt":"Which report should I prepare?","options":["Brief","Detailed","Cancel"]}
```

Omit `options` for a free-text question. Native confirm/select/input/editor
requests use the shared typed owner-decision interface. The original session,
run and request identity stay bound; only an explicit validated owner answer is
returned. No answer, expiry or interruption is not permission. Secret answers
are not requested through this tool. Prose questions and arbitrary interactive
stdin are not converted into invented controls.
The prompt limit is 16,000 UTF-8 bytes; titles and option labels follow the shared
1,000-character text limit. Invalid model arguments return a native tool error
for correction, not a question to the owner or a native process failure.

## Activity, usage and terminal limitations

Management shows effective provider, model, thinking level and native version.
Activity follows native events, including questions, retry and compaction; normal
status checks make no model call. Usage uses one cumulative native baseline per
activation and incremental native events. Input/cache/output totals are reported;
reasoning split and trusted provider spend remain “Not reported.” No pricing
estimate is promoted to billed spend.

Pi's RPC process does not expose an attachment API for an existing interactive
TUI. `fleet terminal` therefore reports unsupported; it neither launches another
writer nor pretends `pi --session` attaches to the running engine. Use management
activity/decisions, controller diagnostics and ordinary room/DM steering. An
independent native TUI is not part of the fleet-managed conversation.

## Related guides
- [Explicit isolated live-provider acceptance](https://github.com/control-flow-project/crossfire/blob/main/services/fleetd/tools/README.md#explicit-pi-provider-acceptance)
- [Common configuration and coordination defaults](configuration.md)
- [Sleep, stop, saved-history resume and fresh-history confirmation](sessions.md)
- [Management and owner decisions](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/runtime.md)
- [Fleet statistics](https://github.com/control-flow-project/crossfire/blob/main/services/crossfire/docs/statistics.md)
- [Controller operations and failure boundaries](https://github.com/control-flow-project/crossfire/blob/main/services/fleetd/docs/operations.md)
