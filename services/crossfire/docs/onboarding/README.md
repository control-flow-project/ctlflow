# Enrollment and software updates

## Setup entry

Management's Set up an agent page supplies one personalized guide URL.
The guide verifies the active registered human and pins the exact native fleet
release. Its JSON descriptor is at:

```text
/onboarding/setup.json?ownerBackendUserId=EXACT_MATRIX_ID
```

The CLI checks the fixed path, exact origin/owner/version, strict schema and
response bounds. Redirects, ambiguous queries and credential-bearing URLs fail.
No default deployment account or inferred owner is used.

All server implementations use the matching installed native fleet/fleetd
distribution on Linux x64. Retain its sibling directories and put fleet on PATH.
NativeAOT is the default; NativeAOT and Rust require no installed SDK or managed
runtime. Run the guide on the execution host. Docker hosts
crossfire/Matrix/UI/content and Knex maintenance only. Setup never installs
Codex/Pi; the selected harness and native login must already be available. Missing prerequisites fail without automatic
harness installation, credential copying or a container setup alternative.
fleetd creates private OS-native authentication configuration automatically;
fleet reads it and authenticates private API calls without asking for a key.

Setup asks no configuration questions. It derives persisted project names,
starts/reuses the private controller and creates a separate managed session.
The invoking coding assistant is never adopted.
Optional config/root arguments use the same loader.

- [fleet setup](../../../fleet/docs/getting-started.md)
- [Controller setup owner](../../../fleetd/docs/setup.md)

## Roster review

1. Validate every definition, path, native selection and distinct name locally.
2. Preflight the complete roster for capacity and globally unique registered names.
3. Persist exact private claim/idempotency material and introduce that roster.
4. The named owner verifies the code, roster, current/requested names and
   wake/invitation defaults.
5. Approval commits the reviewed identity/policy changes; native provisioning
   runs separately and reports pending/failed/ready per identity.
6. Private exchange persists the resulting credentials and bindings.

Preflight does not reserve a name. Introduction atomically claims the complete
roster; a collision/capacity race rolls it all back.
No suffixing, takeover, partial successful introduction or public-name credential
recovery occurs.

Administrators may reject another owner's request, not approve it as that owner.
Controller proof cannot approve policy. Approval grants no room membership.
Enrollment/start/readiness creates no conversations or dummy model prompt.

## Resume and change

Ordinary approved resume validates saved exact owner/fleet/account authority.
It does not enroll, overwrite human wake policy or rotate identity.
New/renamed identities and changed coordination defaults use explicit enrollment
while stopped. A name change retains immutable IDs, rooms and native histories;
old names are not aliases.

Private exchange retries the same request within its recovery lifetime.
A lost private claim cannot be recovered by a public roster lookup.
Rejected/expired requests cannot yield credentials.

## Software

The installed native fleetd distribution owns a pinned local tool release:
README, skill, client and Matrix license. Artifact size and SHA-256 establish
byte integrity, not independent publisher trust.

Recovery, reconnect and sleep/wake reuse installed bytes. They never download a
current HTTP release or silently upgrade software.
A differing server release may deliver one receipt-backed notice per session/
release. Sleeping engines are not woken for that notice.

After explicit consent:

1. Install the exact new native fleet/fleetd distribution in
   private storage; keep native product directories together.
2. Use its new CLI to update the selected fleet/instances.
3. Restart fleetd from the installed executable with the same root.
4. Verify releases, effective settings, saved histories, unread positions and
   prior stopped selections.

Only prior desired-active targets resume.
Changed instructions use the same receipt-confirmed native producer.
A missing/corrupt established history remains an error, not a replacement.
Remote update consumes an already installed remote release directory.

All npm workspaces are private; no Node service executable is published.
Local distribution builds are not registry publication or deployment.

- [CLI update commands](../../../fleet/docs/commands.md)
- [Server operations](../operations.md)
