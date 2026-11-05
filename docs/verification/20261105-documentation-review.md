# Documentation review — 5 November 2026

The review starts from ctlflow `9647de2d3e69f9d43d022be83bd5681ac1753d75`
and covers all 109 tracked prose/instruction files, the native file map and
license, installed-distribution guides and the current setup/packaging sources.
Dated verification records retain their original results and limitations.

Current guides now distinguish the public source/server images from private npm
workspaces and unpublished native archives. Setup uses the matching installed
native distribution. Runtime failure, optional output mirroring and historical
verification links describe the current implementation. Container instructions
separate native initialization from configuration validation in the Knex image.
Two operation descriptions are corrected; API handlers and wire formats do not
change. ctlflow.com has its own authored-copy, generated-reference and browser
verification record.

Verification on Linux amd64 with Node 26.8.1:

| Check | Result |
| --- | --- |
| All product/shared-UI TypeScript checks | Passed |
| Distribution-documentation, documentation-verifier and naming tests | 7 passed; no failures, cancellations or skips |
| Structure, native layout/map, current documentation and timing-policy checks | Passed |
| Aggregate process limit | 8 GiB memory, zero swap, 1024 tasks |
| Final typecheck/test/structure sequence | 3.075 seconds; 879.9 MiB peak memory |

An initial shell invocation omitted the explicit work directory and failed before
running checks. The corrected invocation sets its work directory; the complete
sequence above passes. No quality assertion was weakened.

The three retained 0.1.26 native archives match all previously recorded SHA256SUMS
and byte counts. They were not rebuilt or modified. GitHub's public release
endpoint still returns 404 for `v0.1.26`; archive publication/download verification
remains incomplete. The four image manifests are publicly readable and retain
the recorded digests. Complete anonymous Docker pulls passed on 4 November; this
review does not relabel that earlier test as a new pull or certify new runtime
behavior. No deployment, database change or fleet activation is performed.
