using CtlFlow.Tenancy.Tenantd.Db.Providers;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using WorkspaceDatabase =
    CtlFlow.Tenancy.Tenantd.Db.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Service.Authorization;

internal static partial class TenantAuthorization
{
    internal static async Task<TenantId> ResolveWorkspaceAuthorizationTenant(
        TenantDatabase tenantDatabase,
        WorkspaceId workspaceId,
        CancellationToken cancellation)
    {
        var result = await WorkspaceDatabase.GetWorkspace(
            tenantDatabase,
            workspaceId,
            cancellation);
        return result switch
        {
            WorkspaceLookupResult.Found found =>
                found.Workspace.TenantId,
            WorkspaceLookupResult.NotFound =>
                throw new AuthorizationTargetNotFoundException(),
            _ => throw new InvalidOperationException(
                "Workspace lookup result is invalid")
        };
    }
}
