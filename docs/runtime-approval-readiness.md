# Native decision diagnosis

Use this procedure when an agent appears to be waiting, ignores a reply or cannot
continue after a permission request.

## Distinguish the observations

| Observation | Meaning |
| --- | --- |
| Controller online | Its authenticated lease is current |
| Listener online | The current reporting binding is reachable |
| Working | Native runtime reports active work |
| Waiting for approval/answer | Native runtime reports a blocking request |
| Pending nonblocking question | A question exists; execution may continue |
| Answered | crossfire recorded the owner's selection |
| Responded | The original native socket write completed |
| Lost contact | Execution state is unknown, not a proven crash |

A heartbeat or terminal silence does not establish model progress.
A request-clear event alone does not establish that an answer was applied.

## Inspect

1. Open the agent's Session view. Check current/last-reported state, exact context,
   runtime settings, pending questions and original errors.
2. Open the decision detail. Verify agent, owner, session, turn, request, scope and
   expiration. Opening a choice link does not submit it.
3. Check the owner's protected DM. Shared-room replies do not approve tools.
4. Run `fleet test FLEET` against the actual controller. It does not send a model
   prompt or create a replacement listener.
5. For a running Codex session, use `fleet agent contexts` and
   `fleet agent attach` to obtain the exact native terminal command.

Only the active verified owner can answer. An administrator cannot answer for
another owner. Suspension, generation replacement, cancellation and expiration
invalidate old links. Silence never grants consent.

## Adapter requirements

Codex must expose the selected native features and developer-item injection.
Structured Default-mode questions additionally require
`features.default_mode_request_user_input = true` and actual native support.
Pi uses its owned RPC extension and the common decision port.

Ordinary prose questions and arbitrary interactive shell prompts are not parsed
into decisions. Unsupported native request forms fail explicitly; terminal
scraping is not an alternate control channel.

## Recovery

Transient failures close the failed generation before a bounded same-history
retry. Pending native input is settled before a restart reminder or new message.
When a restarted idle process cannot prove earlier delivery, it receives the
exact retained message as file-backed restart context. That receipt confirms the
new context, not the previous turn's execution.

Do not delete histories, journals or unanswered requests to make readiness pass.
If exact cleanup or history binding cannot be established, preserve evidence and
resolve the specific error before creating another writer.

- [Runtime protocol and failure behavior](../services/crossfire/docs/runtime.md)
- [Session controls](../services/fleet/docs/sessions.md)
- [Implementation limits](architecture/native-implementations.md)
