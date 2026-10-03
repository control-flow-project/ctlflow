# Operator verification

Reusable Crossfire and fleet verification lives in this repository. Deployment
hosts, image/theme configuration, owners and fleet definitions are inputs, not
hardcoded defaults. GAAP owns its deployment commands and Element assets, not a
second implementation of these checks.

## Ownership

```text
services/
  crossfire/
    packages/operator-support/src/
      command.ts
      collections.ts
      files.ts
      http.ts
      process.ts
    tools/
      main.ts
      auth.ts
      database.ts
      enrollment.ts
      fleet-wake.ts
      host.ts
      release.ts
      server.ts
      browser/
        layout.ts
        verify.ts
  fleetd/
    tools/
      main.ts
      verify.ts
      runtime/
        types.ts
        inspect.ts
        codex.ts
```

The support package owns strict command parsing, private JSON evidence, file
fingerprints, bounded HTTP/process execution and complete paginated reads.
Crossfire owns coordination, database, release and management-browser checks.
fleetd owns controller/private-state and native-session inspection. It uses
Fleet's exported daemon client and Crossfire's native adapter exports. The
existing Fleet CLI remains the only operator lifecycle interface; these tools
do not start, stop, upgrade or resume an agent.

- [Crossfire commands and input schemas](../services/crossfire/tools/README.md)
- [fleetd native verification and preservation](../services/fleetd/tools/README.md)
- [Historical script disposition](operator-script-inventory.md)

## Preparation

Use the normal repository prerequisites and build:

```sh
npm ci --ignore-scripts
npm rebuild better-sqlite3 --build-from-source
npm run typecheck
npm run build
```

The tools require Node.js 26+, Unix ownership checks and the packages in the
workspace lockfile. Git, tar, Docker and a Playwright-compatible Chromium
executable are needed only for their respective checks. Current native fleet
inspection supports Codex; unsupported runtimes fail explicitly. Linux is the
verified operator platform. No tool installs a prerequisite or host service.

Store JSON inputs and evidence outside tracked source, with private ownership
and permissions. All commands reject unknown/repeated options and unexpected
JSON fields. Successful output is JSON; `--output` writes a private JSON report.
Failures exit nonzero. The command deadline is five minutes; network/process
operations have shorter bounded deadlines. Credentials and API errors are not
dumped. Screenshots may contain private application data and remain private.

## Repeatable deployment checks

1. Verify the clean source revision/tree and intended release artifacts.
2. Make a consistent backup using the deployment owner's existing procedure.
   Verify its exact checksum and archive listing. A readable archive is not a
   successful restore; verify an isolated restore separately when required.
3. Inspect the current-schema database snapshot and retain it for preservation
   comparison. Capture fleet account/history/provider-file fingerprints with
   fleetd before an upgrade.
4. Deploy using the deployment project's normal image/activation commands and
   the existing Fleet CLI. Verify backups before data changes. These tools
   neither reset data nor add an alternative deployment mechanism.
5. Verify container provenance/isolation, published release/assets, authenticated
   API readiness, protected database records and exact retained native histories.
6. Check desktop/mobile management with a real browser. Run application regression
   tests for mutating workflows; do not turn a live diagnostic into a model prompt.

The checks inspect existing sessions without inference. They cannot certify
provider execution, document-analysis accuracy or macOS behavior without that
separate evidence. They do not infer native process ownership from process names,
answer approvals or create conversations. Enrollment approval and fleet wake
configuration are optional business mutations, guarded by `--execute` and the
complete expected introduction or fleet roster. Authentication creates temporary native/Crossfire login
sessions and cleans them up through normal logout APIs.

## Engineering verification

Operator tests cover boundary validation, cancellation, privacy, pagination,
release tampering, readonly SQLite inspection/preservation, exact enrollment
approval, revision-checked fleet wake configuration and native read-only protocol behavior. Browser geometry checks have
one owner shared by the operator and application browser tests.

```sh
npm test
npm run verify:architecture
npm run verify:installation
npm run verify:container
```

The default runtime selection remains Codex. Claude/Pi tests require the explicit
`--all-runtimes` flag; adding operator tools does not enable those suites.
