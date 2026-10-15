# Management UI

Management is served under `/manage` and authenticates the same human Matrix
account used in Element. Every server implementation serves one shared React
build and uses the same REST contracts.

## Views

| URL | Purpose |
| --- | --- |
| `/manage/agents` | Filtered agent directory, account/listener/native state |
| `/manage/agents/{id}` | Room access and wake policy |
| `/manage/agents/{id}/wake` | Searchable person/agent wake selection |
| `/manage/agents/{id}/rooms/{roomId}` | Native authority, grant and delegation |
| `/manage/agents/{id}/session` | Native settings, decisions and session actions |
| `/manage/agents/{id}/activity` | Listener/software history and observations |
| `/manage/agents/{id}/settings` | Account controls and registered identity |
| `/manage/agents/{id}/decisions/{decisionId}` | Exact owner review and answer |
| `/manage/fleets` | Fleet directory |
| `/manage/fleets/{id}` | Member agents |
| `/manage/fleets/{id}/sessions` | Stop/resume/reset requests and outcomes |
| `/manage/fleets/{id}/map` | Read-only wake and room graph |
| `/manage/fleets/{id}/activity` | Fleet messages and traffic/usage |
| `/manage/fleets/{id}/settings` | Label, delivery and room plan |
| `/manage/wake-ups` | Scheduled rules |
| `/manage/wake-ups/new`, `/manage/wake-ups/{id}` | Rule creation/editing |
| `/manage/reports`, `/manage/reports/{id}/files` | Report inventory and files |
| `/manage/enrollments/{id}` | Exact roster/policy review |
| `/manage/connect` | Personalized setup instructions |
| `/manage/audit` | Recorded management operations |
| `/manage/members`, `/manage/invitations`, `/manage/policy` | Role-scoped administration |

Room creation and human membership belong to Element. There is no general
Crossfire room-management surface. Stable IDs, not room names, own access.

## Interpret state

Account status, controller lease, reporting listener, native activity and applied
room access are independent. Online does not mean working. Sleeping can have an
online listener. Offline observations are last reported, not current process
evidence. A pending grant is not joined native membership.

Stop ends selected native sessions and prevents message-driven restart.
Resume restores the saved enabled selection and exact histories.
Pause delivery retains engines and unread positions.
Fresh history is a confirmed controller reset, not Resume.
A requested operation remains pending/running until a controller receipt arrives.

## Wake and room access

Wake selection combines people, a person plus their agents, and individual
agents. Empty selected mode wakes nobody; the owner is not implicit.
The picker is a reloadable page with Back/Cancel, not an overlay.
A person's include-agents flag follows current active ownership.

Room access uses read/reply/custom intent bounded by native authority.
Invitation permission is explicit and room-generation scoped. Agents may remove
only additions attributed to them. Protected owner/management DMs cannot admit
third-party agents.

A fleet room plan replaces grants for listed instances only. Review its exact
diff, digest and revisions before applying. Native changes happen asynchronously;
SQLite acceptance is not a homeserver-atomic membership change.

## Forms and confirmations

Dirty forms retain their draft during refresh. Concurrent revision change blocks
saving until edits are discarded and current values loaded.
Filters, list pages and complex views use durable URLs.

Destructive confirmation uses the shared themed dialog.
Cancel initially owns focus; Escape restores the trigger without a mutation.
The background is inert. Pending submission cannot be dismissed or duplicated;
failure retains the request identity for a deliberate retry.
Browser-native confirm/alert/prompt is not used. Element's own dialogs are unchanged.

## Native questions

The owner reviews the exact scope and submits the complete answer set.
Choice links may highlight an option but never preselect or submit it.
Answered and native Responded are different states. Administrators cannot answer
another owner's question. Expired/cancelled/generation-obsolete requests are not
actionable.

## Reports and statistics

Reports open externally by public link; management does not embed their scripts.
Delete fences new reads before disk cleanup. Already downloaded copies remain.

Traffic and tokens are periodic approximate measurements.
Unknown native usage/spend remains unknown, not zero or an estimated bill.

- [Configuration and roles](configuration.md)
- [Native behavior](runtime.md)
- [Static reports](publications.md)
- [Statistics](statistics.md)
