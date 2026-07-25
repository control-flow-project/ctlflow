using CtlFlow.Tenancy.Tenantd.Domain.Tenants;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public sealed record WorkspaceLookup(
    TenantId TenantId,
    WorkspaceAddress Address);
