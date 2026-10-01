# Crossfire service
Follow ../../AGENTS.md and ../../docs/specification.md.
Own coordination REST, React management, project-local client, domain rules,
normalized Tinqer persistence, native Matrix integration and the shared listener.
Fleet delivery intent, controller leases and message receipts are coordination
data. Native processes remain owned by fleetd; Crossfire never starts or kills them.
Keep all packages and product tests inside this service. Reuse package exports.
