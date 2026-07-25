using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

internal static partial class WorkspaceResources
{
    internal static async Task<WorkspaceResource> LoadWorkspaceResource(
        IDbContextFactory<TenantDbContext> databaseContexts,
        WorkspaceId workspaceId,
        CancellationToken cancellation)
    {
        var result = await Workspaces.QueryWorkspaceResource(
            databaseContexts,
            workspaceId,
            cancellation);
        return result switch
        {
            ResourceLookupResult<WorkspaceResource>.Found found =>
                found.Resource,
            _ => throw new InvalidOperationException(
                "Committed Workspace resource was not found")
        };
    }
}
