using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public abstract record AuditTarget
{
    private AuditTarget()
    {
    }

    public sealed record Tenant(TenantId TenantId) : AuditTarget;

    public sealed record Workspace(
        TenantId TenantId,
        WorkspaceId WorkspaceId) : AuditTarget;
}
