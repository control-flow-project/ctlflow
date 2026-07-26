using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceMappings;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    public static async Task<WorkspaceListResult> ListWorkspaces(
        TenantDatabase tenantDatabase,
        TenantId tenantId,
        PageSize pageSize,
        WorkspaceId? afterWorkspaceId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = TenantDbTelemetry.StartOperation(
            "list_workspaces");
        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var tenantIdValue = tenantId.Value;
        var queryCancellation = cancellation;

        var tenantExists = await database.Tenants
            .AsNoTracking()
            .AnyAsync(
                tenant => EF.Property<string>(tenant, "_id") == tenantIdValue,
                queryCancellation);
        if (!tenantExists)
        {
            return new WorkspaceListResult.TenantNotFound();
        }

        var take = pageSize.Value + 1;
        WorkspaceDetails[] candidates;
        if (afterWorkspaceId is null)
        {
            var rows = await database.Workspaces
                .AsNoTracking()
                .Where(workspace =>
                    EF.Property<string>(workspace, "_tenantId")
                        == tenantIdValue)
                .OrderBy(workspace =>
                    EF.Property<string>(workspace, "_id"))
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
                .Take(take)
                .ToListAsync(queryCancellation);
            candidates = rows
                .Select(row => CreateWorkspaceDetails(
                    row.Id,
                    row.TenantId,
                    row.Address,
                    row.DisplayName,
                    row.State,
                    row.Revision,
                    row.CreatedAt,
                    row.UpdatedAt))
                .ToArray();
        }
        else
        {
            var afterValue = afterWorkspaceId.Value;
            var rows = await database.Workspaces
                .AsNoTracking()
                .Where(workspace =>
                    EF.Property<string>(workspace, "_tenantId")
                        == tenantIdValue
                    && string.Compare(
                        EF.Property<string>(workspace, "_id"),
                        afterValue) > 0)
                .OrderBy(workspace =>
                    EF.Property<string>(workspace, "_id"))
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
                .Take(take)
                .ToListAsync(queryCancellation);
            candidates = rows
                .Select(row => CreateWorkspaceDetails(
                    row.Id,
                    row.TenantId,
                    row.Address,
                    row.DisplayName,
                    row.State,
                    row.Revision,
                    row.CreatedAt,
                    row.UpdatedAt))
                .ToArray();
        }

        var page = await CreateWorkspacePage(
            candidates,
            pageSize,
            cancellation);
        return new WorkspaceListResult.Found(page);
    }
}
