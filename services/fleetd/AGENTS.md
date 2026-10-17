# fleetd controller service
Follow ../../AGENTS.md and ../../docs/specification.md.
Own the named user-scoped daemon, explicit directory registry, operations and
runtime lifecycle. Reuse crossfire listener/runtime/coordination package exports.
No duplicate listener, Matrix authorization, UI orchestration or model housekeeping.
The HTTP API is private Unix-socket based; remote clients tunnel through SSH.
Storage owns OS-native fleetd.json and serialized persistent random-key
initialization. Every endpoint authenticates that key before dispatch.
