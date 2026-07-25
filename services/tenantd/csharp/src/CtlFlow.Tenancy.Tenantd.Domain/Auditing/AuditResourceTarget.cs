using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public abstract record AuditResourceTarget
{
    private AuditResourceTarget()
    {
    }

    public sealed record Tenant(TenantId TenantId) : AuditResourceTarget;

    public sealed record Workspace(
        TenantId TenantId,
        WorkspaceId WorkspaceId) : AuditResourceTarget;
}
