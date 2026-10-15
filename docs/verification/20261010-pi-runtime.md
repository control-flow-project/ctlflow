# Earendil Pi runtime integration

## Scope and state

The owner authorized implementation of Earendil Pi through the existing native
runtime adapters. Work starts from synchronized main `74f3739` on
`feat/pi-owned-runtime-20261010`. Codex remains implemented; Claude remains
unimplemented. Bad Bets and GAAP source, production services, original credential
stores and native histories are untouched. No delegation occurred. Real-provider
acceptance uses a private temporary credential copy and synthetic histories,
not an enrolled fleet or an imported coding conversation.

Implementation and integrated verification are complete. The owner subsequently
authorizes committing and pushing the feature branch for manual PR review.
Workspace versions remain `0.1.19`; this work is not a published release.
No production deployment or package publication is performed here.

## Architecture and ownership

| Requirement | Owner and current implementation |
| --- | --- |
| Native transport, settings and evidence | Private `@ctlflow/crossfire-adapter-pi`; stock Pi RPC and an explicitly loaded native extension |
| Processes and fleet lifecycle | Existing fleetd owner; the adapter implements the same typed lifecycle, context, delivery, observation and decision ports as Codex |
| Message routing and policy | Existing shared listener; no Pi listener, model-based admission or terminal scraping |
| Durable input and uncertain restart | Existing delivery journal and shared adapter-runtime resumption-file producer; exact original input and separate continuation correlation |
| Human answers and management | Existing Crossfire owner-decision authority and UI; session/run/request validation applies to both runtimes |
| Usage and storage | Shared usage contracts; unknown reasoning remains null, including mixed aggregates; atomic forward migration to schema 16 |
| Distribution | Private adapter bundled into public fleetd; no requirement to publish internal packages |

Pi-specific protocol and filesystem behavior remain inside its adapter. The
Codex resumption-file producer moves to adapter-runtime rather than being copied
or retained behind a second path. Fleetd composes the concrete adapters; domain
and listener code do not import the Pi transport. Claude has no placeholder
implementation. Required forward migrations preserve existing data and leave
one current schema, not concurrent readers or writers.

Native terminal attachment is an explicit capability. Pi reports it unavailable:
opening another `pi --session` would create a competing writer, not attach to the
running RPC process. No compatibility transport or emulated TUI is introduced.

## Native prerequisite and selection

The adapter requires stock Pi `1.0.0`, released 1 October 2026. On the inspection
date, `1.1.0` was too recent for the unchanged seven-day dependency policy.
The exact executable version is checked before admission; no version substitution
or policy exception is added. Automatic native acceptance uses the pinned upstream
tarball and an isolated inert local provider, with no external model requests.
Separately authorized live acceptance uses the same stock executable and adapter
against actual OpenAI inference with an exact provider/model/thinking selection.

- [Native RPC documentation](https://pi.dev/docs/latest/rpc)
- [Earendil Pi source](https://github.com/earendil-works/pi)

Provider, model and thinking selections are checked against actual native
availability before settings are applied; effective settings are checked again.
Unavailable combinations and Codex-specific sandbox/approval parameters are
rejected instead of clamped or silently changed. Auth/model configuration is
validated and recopied for each activation; removing a source file removes its
old managed copy. Already-running engines are not silently hot-switched.

## Proven behavior

- Native SessionManager initializes an exclusively reserved private file and
  retains its exact session UUID. Verified instructions are recorded by native
  extension APIs before readiness, with no model calls or fabricated chat turns.
- Shared and per-room histories retain exact file, UUID, workspace and instruction
  identity. Discovery is read-only. Missing established history fails explicitly;
  deliberate reset archives the old files and receipts.
- A delivery receipt requires the actual user entry, exact correlated message
  identity/text and inclusion on the current native branch. RPC success is not
  a receipt. Evidence is flushed before journal acknowledgement.
- Uncertain restart uses the same saved history and a private file containing the
  original attributed input. A separately correlated continuation states the
  uncertainty and requests continuation without repeating completed effects.
- Busy ordinary input stays in the existing durable journal, not a second Pi
  steering queue. Accepted mentions capture the actual run, abort that fenced
  run and wait for idle before replacement. Stale captures cannot abort a new
  run or a restarted process.
- Sleep/wake, stop/resume, controller restart and idle native-process crash
  recovery preserve the same history. Completing a short-lived Matrix mention
  admission does not cancel a ready native room.
- Native confirm/select/input/editor questions retain exact owner-answer authority,
  timeout, cancellation and generation fences. Invalid model question arguments
  produce a native tool error for correction, not a process crash or malformed
  owner decision. Unicode byte limits and control characters are covered.
- Structured visible text and tool results go to the owner's DM; thinking traces
  and tool-call arguments do not. Failure diagnostics honor the existing
  4,000-UTF-8-byte status contract without constraining ordinary output.
- Native activity covers work, questions, retry and compaction. Usage takes one
  native cumulative baseline per activation and then incremental events; no
  model polling. Unknown reasoning and trusted spend are not reported as zero.
- Deployed numeric usage, checkpoints, foreign keys and indexes survive the
  transactional schema migration. Injected failure rolls back the entire change.
- Real browser checks cover mobile/desktop runtime views, Pi settings, setup
  instructions, owner controls and unknown-reasoning statistics. Actual packed
  public entrypoints admit Pi without resolving internal packages from npm.

## Live-provider acceptance

On 10 October 2026 actual stock Pi `1.0.0`, native `openai-codex`, `gpt-6-luna`,
`medium` completes all eleven checks through the ordinary adapter and shared
fleet lifecycle. Provider/model availability is not substituted for actual
completed inference. No Pi SDK dependency, second listener, production fleet,
global installation change or automatic cross-harness credential importer is added.

| Check | Evidence |
| --- | --- |
| Startup | Exact effective native settings, zero model calls, unsupported live attachment |
| Response and file tool | Exact conversation nonce and exact native-written file bytes |
| Owner choice | Native question, exact session/run/request correlation, explicit choice B reaches model |
| Owner text | Unique explicit owner answer reaches model unchanged |
| Question interruption | Unanswered question cancels; replacement completes; stale capture is inactive |
| Tool interruption | Real FIFO-blocked Bash process is interrupted and gone before replacement |
| Sleep and wake | Same native history remembers conversation; authentication recopied |
| Controller stop/resume | Recreated lifecycle resumes exact native UUID and conversation |
| Process identity | Native tool establishes exact owned PID for the crash proof |
| Idle crash | Injected SIGKILL reports one failure; recovery keeps UUID and adds no model turn |
| Per-room contexts | Separate native histories cannot recall each other's nonce; exact room resume recalls it |

The first complete live run records 18 measured model responses, 55,995 input
tokens including 35,840 cached input, and 449 output tokens (56,444 total).
The final-tool repeat also passes all eleven checks with 18 measured responses:
55,851 input including 33,280 cached input, 462 output, 56,313 total. Its four
shared activations and four readiness transitions are distinct from the single
deliberately injected native failure; room processes are not mislabeled as
shared activations.
Reasoning split and trusted billed spend remain unknown, not zero. These are
native usage observations, not independent billing certification. An earlier
single-turn provider probe also completes with the exact response and native
2,661 input / 12 output tokens.

The reusable internal tool is `services/fleetd/node/tools/pi-provider-acceptance.ts`.
It requires explicit `--execute`, an exact native executable and a private owned
evidence directory; it only creates synthetic disposable workspaces. Finite
4 GiB/no-swap/512-task process limits, request/token observations and deadlines
bound the proof, not product behavior or provider billing. Four automated negative
checks prove consent, private/symlink/cancellation boundaries, zero-model rejection
of an unavailable model, and cleanup after a nonmatching actual native response.
Reports retain phases, timings and usage, never credentials or model responses.
The automatic test suite uses only the inert provider.
Live owner answers are supplied through the existing runtime decision hook in
the isolated proof. Matrix authorization and browser decision controls are
verified separately by the integrated suites; no live enrolled Matrix fleet is
created for provider acceptance.

Original credential-store bytes remain identical to the before-proof fingerprint.
No owned live native processes remain. All isolated credential copies and
synthetic histories from both runs and the first-turn probe are removed; only
redacted private evidence is retained. Logs:

- `.temp/pi-verification/live-first.log`
- `.temp/pi-verification/live-acceptance.log`
- `.temp/pi-verification/live-acceptance-final.log`
- `.temp/pi-verification/live-provider-evidence`
- `.temp/pi-verification/live-cleanup.log`
- `.temp/pi-verification/provider-tool-focused-final.log`

## Final integrated gates

Source remained unchanged throughout the final run. The command sequence is
`npm run typecheck`, `npm test`, `npm run verify:architecture`,
`npm run verify:installation`, `npm run verify:container`. Build is included in
the repository test and container workflows. Aggregate process-group limits are
24 GiB memory, zero swap and 8,192 tasks.

| Gate | Result |
| --- | --- |
| Typecheck and build | Pass |
| Product tests | 825 pass; zero failures, cancellations or incomplete files |
| Product execution | 180 isolated files; 24 workers; 83,100 ms test execution |
| Architecture and ownership | 33 architecture checks and structure gate pass |
| Installation | Four checks pass; public-bundle entrypoint tests also pass in product suite |
| Container acceptance | Startup, Element public rooms and authenticated attachment download, React/native routes, artifacts, shutdown and retained rooms pass |
| Dependency and package invariants | All 97 external lock records unchanged; all 28 manifest/lock/privacy records aligned |
| Whitespace | `git diff --check` passes |

Final raw evidence:

- `.temp/pi-verification/full-gates-live-final.log`
- `.temp/test-runs/2026-10-10T10-09-40.347Z-1925905/summary.json`
- `services/crossfire/.temp/container-verification-Ahp3G1`
- Container image `crossfire-runtime:7616fd76c1c5852b396f`
- `.temp/pi-verification/dependency-invariants-live-final.log`

## Retained failures and corrections

The first full 817-test run failed on an undeclared daemon application dependency,
an installed-entrypoint error-shape expectation and an unchanged released-port
fixture's `EADDRINUSE`. The dependency and expectation are corrected. The unchanged
port fixture passes subsequent full runs; this is not a claimed product root-cause
fix for that transient failure.

A focused invocation used the wrong working directory for four architecture
checks. Its native tests passed, but it is not architecture certification.
An intermediate container run failed because editing source during acceptance
changed the image fingerprint and forced another build during restart. The
unchanged readiness deadline was not extended; final acceptance uses frozen
source and passes.

Red/green regressions establish and correct three owning Pi defects: ready-room
lifetime was coupled to short-lived mention admission; failure text could violate
the shared status contract; and model question arguments could violate the shared
owner-decision contract. The last regression executes on stock Pi and covers
oversize Unicode prompts, control characters and invalid titles/choices. No gate,
deadline or assertion was weakened. Earlier green 819-, 820- and 821-test runs
are superseded by the final unchanged-source 825-test run after provider-tool
verification is included.

## Explicit limitations

Verification is Linux with stock Pi, an inert local provider and the selected
live OpenAI provider/model. There is no all-provider/model, macOS-hardware or
production certification. Native tool execution
has the controller's privileges: Pi does not supply a permission/filesystem
sandbox, and prompt instructions are not security enforcement. Per-room history
separates conversations, not shared files, credentials or tool access.

Orderly shutdown and hard interruption clean up the tested native shell children.
An abrupt `SIGKILL` during a detached native tool can orphan that tool; arbitrary
subprocess containment and every possible crash are not certified. No hidden
supervisor or orphan adoption is added. Exact idle-process crash recovery is
tested. Unknown receipt recovery does not promise exactly-once external effects.
Live TUI attachment remains natively unavailable and is rejected explicitly.

The configuration and operational guide is `services/fleet/docs/pi.md`.
