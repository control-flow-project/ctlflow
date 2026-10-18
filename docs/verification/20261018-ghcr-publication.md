# GHCR image publication verification

Date: 2026-10-18. Scope: publishing the five already-tested generic 0.1.22
server/maintenance images and replacing documentation placeholders with exact
registry references. No fleet image, site image, provider credential or fleet
definition was published. Production deployments and native sessions were not
changed.

## Release identity

The images were built from source commit
`401bc39cb0e1ca399056e00c72598cefde9eeb87`, with build-source digest
`6e37a01daca48b95505a427977547130db548614deb1e97568e13cce410fe805`.
They are frozen Linux amd64 builds, not rebuilds of the current main branch.
Later documentation/onboarding UI changes are not contained in those images.
The version was not reused for different bytes.

The [release reference](../../services/crossfire/docs/releases/0.1.22.md)
records the four server manifests and shared Knex manifest. Registry manifest
digests were checked independently of Docker configuration IDs and exported
archive descriptors. Package schema 2 and capability label 1 remain unchanged.

## Verification

| Check | Result |
| --- | --- |
| Upload exact version tags | Five published between 11:28:38 and 11:30:19 UTC |
| Registry manifest/configuration identities | All five match the tested local images |
| Authenticated immutable digest pulls | Five passed between 11:36:27 and 11:36:41 UTC |
| Pulled platform, backend, version and source labels | All five passed |
| Credential handling | Private input; temporary Docker login removed after each operation |
| Initial anonymous pulls | All five rejected with HTTP 401; packages were private |
| Documentation links and factual-language checks | Passed; 70 current Markdown files |
| Repository structure, ownership and test-selection checks | Passed |
| Release and quickstart references | Five release digests and both quickstart references match pull receipts |
| Shell examples and whitespace | Syntax and diff checks passed |

Docker reused existing local filesystem layers during the pulls. These checks
verify registry access, manifest identity and exact tested image configurations;
they are not a measurement of cold-cache download throughput.

GitHub creates new packages privately. The supported package-settings visibility
change was requested from the organization owner. The authenticated pull result
does not establish anonymous availability. Registry publication does not activate
or migrate GAAP, Bad Bets or any other deployment.

The [preceding Docker/host-fleet verification](20261018-server-docker-host-fleets.md)
ran the same seven local server, Matrix, management, content and host-native
attachment assertions for each of these four server image configurations.
That evidence is retained separately; no complete runtime or paid-provider test
suite was rerun merely to publish unchanged image bytes.
