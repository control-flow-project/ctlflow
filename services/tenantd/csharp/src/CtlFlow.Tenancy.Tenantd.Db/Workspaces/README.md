# Workspace persistence placeholder

This directory will own explicit EF mapping and fixed persistence operations for
Workspace and Workspace-address records. `ConfigureWorkspace.cs`,
`ConfigureWorkspaceAddressBinding.cs`, and `QueryWorkspaceResolution.cs` arrive
with the same Knex migration and canonical test change.

No generic repository, raw SQL path, runtime migration, or second persistence
model belongs here.
