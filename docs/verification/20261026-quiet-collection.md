# Quiet native-output selection, 26 October 2026

Collectors can produce a native output event for every downloaded item. With
mirroring enabled, each event can become an owner-DM message. Per-instance
`listener_options.mirror_output = false` suppresses newly observed native text,
tool results and final output before it enters the output-delivery journal.
The default remains true. Explicit messages, approvals/questions, listener
notices, activity, usage and saved native histories retain their existing owners.
Previously journaled deliveries retain their recorded identities.

Node, managed C#, NativeAOT and Rust implement the same TOML and JSON contracts.
The shared acceptance suite verifies both Codex and Pi, real native-provider
execution, Matrix delivery suppression, unchanged history, intentional messaging,
invalid-setting rejection and configuration persistence through unrelated edits.

Current source verification completed on 26 October:

| Gate | Result |
| --- | --- |
| Node typecheck/build/tests and architecture | 974 tests across 213 files; 33 architecture checks passed |
| Rust format, clippy and complete tests | 282 tests across 137 test binaries passed |
| C# core, Matrix integration, SQLite interchange and managed/AOT runtime | Passed; runtime bank 584 assertions |
| Shared native acceptance | 117 tests per target; all four targets passed with zero failures, cancellations or skips |
| Shared container acceptance | 33 tests per target; all four targets passed with zero failures, cancellations or skips |
| Strict performance matrix | 96 measurement groups and 24 comparisons passed |

The container transfer fixture restores the original service before removing its
replacement image and temporary Compose files. Image removal uses the existing
five-minute artifact-operation bound. An earlier managed-C# attempt failed when
Docker image cleanup exceeded the generic thirty-second command limit. That
failure remains a failed attempt; the final complete four-target bank passed.
No application health assertion or performance threshold was relaxed.

These checks establish source/build behavior. They do not certify registry
publication, production deployment or a live collector's configuration. Published
0.1.24 packages do not contain this new setting. Activation requires a matching
reviewed release and the normal explicit update and stop/resume workflow.
