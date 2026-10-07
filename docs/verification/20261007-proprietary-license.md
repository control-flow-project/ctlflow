# 2026-10-07: proprietary licensing and resume instructions

## Scope and ownership

First-party repositories: Crossfire, GAAP site/agents, Bad Bets site/agents,
CtlFlow, Pacta and UI SDK. Each root uses the same proprietary commercial
LICENSE, copyright 2026 Jeswin P Kumar, jeswinpk@agilehead.com. The notice
requires a separate written commercial agreement; public package availability
does not grant open-source rights. It excludes dependency materials and does
not retroactively revoke earlier license grants. This is a license draft,
not a legal opinion or certification.

All 95 owned npm manifests declare the same author and `SEE LICENSE IN LICENSE`.
There are 98 byte-identical LICENSE files across the roots and package roots.
All 94 existing owned workspace-lock entries declare that license. Pacta's
`tools/package.json` is a standalone helper, not a declared locked workspace;
no artificial workspace/link or dependency change is introduced. CtlFlow's
34 .NET projects inherit copyright/author and canonical license packaging.
Bad Bets research declares its author, `LicenseRef-Proprietary` and LICENSE file.

Crossfire preserves its two public products and all private internal packages.
Public fleet/fleetd archives include LICENSE. Standalone agent-tool README
includes the complete license; its executable carries the first-party notice.
Existing Matrix-spec and bundled dependency notices remain unchanged. Other
repositories retain their existing package visibility, versions and dependencies.

The resumed-task reminder changes only the existing continuation text: read
applicable AGENTS.md files before continuing authorized unfinished work with
saved history. Receipt recovery, original room attribution and unanswered
permissions/questions are unchanged. No new activation mechanism is introduced.

## Current-source verification

- Fleet/fleetd typecheck and build pass; no Crossfire UI or server deployment.
- 13 focused tests pass: package ownership, exact installed public tarballs and
  continuation delivery/receipt/history/attribution assertions.
- Structure, test-timing/runtime-selection guards and whitespace checks pass.
- Cross-repository audit checks every manifest and LICENSE copy. Removing only
  the authorized metadata changes yields the original manifests. All third-party
  lock entries and non-license lock data compare exactly with their original state.
- UI SDK npm dry-run includes LICENSE; its package-check script passes syntax
  validation. Its complete SDK build/browser/package suite is not run.
- Bad Bets Python metadata parses correctly; offline `uv lock --check` passes
  without changing the dependency lock or environment.
- Installed MSBuild 10.0.400 evaluates all 34 CtlFlow project properties and
  license packaging items successfully, without build or restore. The repository
  pins SDK 10.0.302, which is unavailable locally; no pinned-SDK build is claimed
  and its selection policy is not changed.

Sibling edits use isolated feature worktrees based on current origin/main.
Existing shared uncommitted work remains outside those changes. No production
data, native session, server, fleet, package publication or deployment is changed.
