using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    internal static async Task<TenantId?> FindWorkspaceTenantId(
        TenantDatabase tenantDatabase,
        WorkspaceId workspaceId,
        CancellationToken cancellation)
    {
        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var workspaceIdValue = workspaceId.Value;
        var queryCancellation = cancellation;
        var tenantId = await database.Workspaces
            .AsNoTracking()
            .Where(workspace =>
                EF.Property<string>(workspace, "_id") == workspaceIdValue)
            .Select(workspace =>
                EF.Property<string>(workspace, "_tenantId"))
            .SingleOrDefaultAsync(queryCancellation);
        return tenantId is null ? null : TenantId.FromStorage(tenantId);
    }
}
