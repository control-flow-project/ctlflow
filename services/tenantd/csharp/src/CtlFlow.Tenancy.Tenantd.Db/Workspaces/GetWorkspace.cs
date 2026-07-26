using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceMappings;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    public static async Task<WorkspaceLookupResult> GetWorkspace(
        TenantDatabase tenantDatabase,
        WorkspaceId workspaceId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = TenantDbTelemetry.StartOperation("get_workspace");
        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var workspaceIdValue = workspaceId.Value;
        var queryCancellation = cancellation;
        var row = await database.Workspaces
            .AsNoTracking()
            .Where(workspace =>
                EF.Property<string>(workspace, "_id") == workspaceIdValue)
            .Select(workspace => new
            {
                Id = EF.Property<string>(workspace, "_id"),
                TenantId = EF.Property<string>(workspace, "_tenantId"),
                Address = EF.Property<string>(workspace, "_address"),
                workspace.DisplayName,
                workspace.State,
                workspace.Revision,
                workspace.CreatedAt,
                workspace.UpdatedAt
            })
            .SingleOrDefaultAsync(queryCancellation);

        return row is null
            ? new WorkspaceLookupResult.NotFound()
            : new WorkspaceLookupResult.Found(CreateWorkspaceDetails(
                row.Id,
                row.TenantId,
                row.Address,
                row.DisplayName,
                row.State,
                row.Revision,
                row.CreatedAt,
                row.UpdatedAt));
    }
}
