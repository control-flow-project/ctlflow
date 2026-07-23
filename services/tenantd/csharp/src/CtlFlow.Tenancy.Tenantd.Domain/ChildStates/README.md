# Child-state domain placeholder

This directory will own typed provisioning/deletion step identities, statuses,
acknowledgements, and idempotency rules used by Tenant and Workspace lifecycle
coordination.

The first public operation file is `AcknowledgeChildState.cs` only when its full
contract and canonical tests are added. It must not call another service or use
wire/persistence types.
