using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Workspaces.WorkspaceMappings;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    public static async Task<WorkspaceMutationResult> CreateWorkspace(
        TenantDatabase tenantDatabase,
        WorkspaceId workspaceId,
        TenantId tenantId,
        ResourceAddress address,
        DisplayName displayName,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = TenantDbTelemetry.StartOperation(
            "create_workspace");
        await using var mutation =
            await tenantDatabase.AcquireMutation(tenantId, cancellation);
        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var tenantIdValue = tenantId.Value;
        var workspaceIdValue = workspaceId.Value;
        var addressValue = address.Value;
        var queryCancellation = cancellation;
        var parentState = await database.Tenants
            .AsNoTracking()
            .Where(tenant =>
                EF.Property<string>(tenant, "_id") == tenantIdValue)
            .Select(tenant => (ResourceState?)tenant.State)
            .SingleOrDefaultAsync(queryCancellation);
        var byId = await database.Workspaces
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
        var byAddress = await database.Workspaces
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
        var decision = await Domain.Workspaces.Workspaces.CreateWorkspace(
            workspaceId,
            tenantId,
            address,
            displayName,
            parentState,
            byId is null
                ? null
                : CreateWorkspaceDetails(
                    byId.Id,
                    byId.TenantId,
                    byId.Address,
                    byId.DisplayName,
                    byId.State,
                    byId.Revision,
                    byId.CreatedAt,
                    byId.UpdatedAt),
            byAddress is null
                ? null
                : CreateWorkspaceDetails(
                    byAddress.Id,
                    byAddress.TenantId,
                    byAddress.Address,
                    byAddress.DisplayName,
                    byAddress.State,
                    byAddress.Revision,
                    byAddress.CreatedAt,
                    byAddress.UpdatedAt),
            audit,
            cancellation);
        if (decision is not WorkspaceMutationResult.Changed changed)
        {
            return decision;
        }

        database.Workspaces.Add(changed.Workspace);
        try
        {
            await database.SaveChangesAsync(cancellation);
            return changed;
        }
        catch (DbUpdateException exception)
        {
            var retry = await ClassifyWorkspaceCreation(
                tenantDatabase,
                workspaceId,
                tenantId,
                address,
                displayName,
                audit,
                cancellation);
            if (retry is WorkspaceMutationResult.Changed)
            {
                throw new InvalidOperationException(
                    "Workspace creation failed without an ownership conflict",
                    exception);
            }

            return retry;
        }
    }

    private static async Task<WorkspaceMutationResult>
        ClassifyWorkspaceCreation(
            TenantDatabase tenantDatabase,
            WorkspaceId workspaceId,
            TenantId tenantId,
            ResourceAddress address,
            DisplayName displayName,
            AuditContext audit,
            CancellationToken cancellation)
    {
        await using var database = await tenantDatabase.Contexts.CreateDbContextAsync(
            cancellation);
        var tenantIdValue = tenantId.Value;
        var workspaceIdValue = workspaceId.Value;
        var addressValue = address.Value;
        var queryCancellation = cancellation;
        var parentState = await database.Tenants
            .AsNoTracking()
            .Where(tenant =>
                EF.Property<string>(tenant, "_id") == tenantIdValue)
            .Select(tenant => (ResourceState?)tenant.State)
            .SingleOrDefaultAsync(queryCancellation);
        var byId = await database.Workspaces
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
        var byAddress = await database.Workspaces
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

        return await Domain.Workspaces.Workspaces.CreateWorkspace(
            workspaceId,
            tenantId,
            address,
            displayName,
            parentState,
            byId is null
                ? null
                : CreateWorkspaceDetails(
                    byId.Id,
                    byId.TenantId,
                    byId.Address,
                    byId.DisplayName,
                    byId.State,
                    byId.Revision,
                    byId.CreatedAt,
                    byId.UpdatedAt),
            byAddress is null
                ? null
                : CreateWorkspaceDetails(
                    byAddress.Id,
                    byAddress.TenantId,
                    byAddress.Address,
                    byAddress.DisplayName,
                    byAddress.State,
                    byAddress.Revision,
                    byAddress.CreatedAt,
                    byAddress.UpdatedAt),
            audit,
            cancellation);
    }
}
