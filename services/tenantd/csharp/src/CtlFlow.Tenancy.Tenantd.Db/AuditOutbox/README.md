# Audit-outbox persistence placeholder

This directory will own the transactionally written audit outbox required by
future state-changing Tenant and Workspace operations. Delivery to `auditd` is
separate from the local state transaction and retry-safe.

Resolution remains read-only and does not add an audit outbox write.
