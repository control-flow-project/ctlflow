# Operator check inventory

| Concern | Current owner |
| --- | --- |
| Exact release/artifact bytes | Crossfire release check |
| Visible API roster, observations and grants | Crossfire server check |
| Existing management views and geometry | Crossfire browser check |
| Public report credential isolation | Crossfire content check |
| SQLite identity/schema/integrity/counts | Crossfire database check |
| Protected record preservation | Crossfire preservation check |
| Owned file hashes | Operator-support file check |
| Source revision/tree and archive listing | Crossfire source/archive checks |
| Rootless image/provenance/runtime hardening | Crossfire host check |
| Exact pending enrollment review | Crossfire enrollment check |
| Reviewed complete-roster wake changes | Crossfire fleet-wake check |
| Current controller/native binding | fleetd verify |
| Provider-file/context preservation | fleetd snapshot/preserve |
| Offline observation-journal conversion | fleetd migrate-observations |
| Explicit selected Pi provider execution | fleetd provider-acceptance tool |
| Setup/update/start/stop/reset | Fleet CLI and controller lifecycle |

Generic checks take deployment-specific inputs.
Site repositories own activation, TLS, theme and fleet definitions.
Research extraction/indexing/document helpers are not Crossfire capabilities.

One-off destructive reset scripts, broad process-name killing, copied runtimes,
generated SDKs, provider caches and fixture checkouts are not promoted as reusable
operator tools. Current source tests own regression reproductions; scratch scripts
do not become alternate runtime paths.

- [Procedure and evidence limits](operator-tools.md)
- [Crossfire commands](../services/crossfire/node/tools/README.md)
- [fleetd commands](../services/fleetd/node/tools/README.md)
