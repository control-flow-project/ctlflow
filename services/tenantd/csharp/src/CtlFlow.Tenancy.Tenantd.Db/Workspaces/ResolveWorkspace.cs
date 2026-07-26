using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceMappings;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    public static async Task<WorkspaceResolutionResult> ResolveWorkspace(
        TenantDatabase tenantDatabase,
        TenantId tenantId,
        ResourceAddress address,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = TenantDbTelemetry.StartOperation(
            "resolve_workspace");
        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var tenantIdValue = tenantId.Value;
        var addressValue = address.Value;
        var queryCancellation = cancellation;
        var parentState = await database.Tenants
            .AsNoTracking()
            .Where(tenant =>
                EF.Property<string>(tenant, "_id") == tenantIdValue)
            .Select(tenant => (ResourceState?)tenant.State)
            .SingleOrDefaultAsync(queryCancellation);
        var row = await database.Workspaces
            .AsNoTracking()
            .Where(workspace =>
                EF.Property<string>(workspace, "_tenantId") == tenantIdValue
                && EF.Property<string>(workspace, "_address") == addressValue)
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
        var candidate = row is null
            ? null
            : CreateWorkspaceDetails(
                row.Id,
                row.TenantId,
                row.Address,
                row.DisplayName,
                row.State,
                row.Revision,
                row.CreatedAt,
                row.UpdatedAt);
        return await Domain.Workspaces.Workspaces.ResolveWorkspace(
            candidate,
            parentState,
            cancellation);
    }
}
