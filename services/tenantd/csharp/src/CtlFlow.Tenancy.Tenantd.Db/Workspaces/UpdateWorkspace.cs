using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using CtlFlow.Tenancy.Tenantd.Db.Providers;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    public static async Task<WorkspaceMutationResult> UpdateWorkspace(
        TenantDatabase tenantDatabase,
        WorkspaceId workspaceId,
        Revision expectedRevision,
        DisplayName displayName,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = TenantDbTelemetry.StartOperation(
            "update_workspace");
        var tenantId = await FindWorkspaceTenantId(
            tenantDatabase,
            workspaceId,
            cancellation);
        if (tenantId is null)
        {
            return new WorkspaceMutationResult.NotFound();
        }

        await using var mutation =
            await tenantDatabase.AcquireMutation(tenantId, cancellation);
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
        if (row is null)
        {
            return new WorkspaceMutationResult.NotFound();
        }

        var workspace = await Domain.Workspaces.Workspaces.RestoreWorkspace(
            WorkspaceId.FromStorage(row.Id),
            TenantId.FromStorage(row.TenantId),
            Domain.Addresses.ResourceAddress.FromStorage(row.Address),
            row.DisplayName,
            row.State,
            row.Revision,
            row.CreatedAt,
            row.UpdatedAt,
            cancellation);
        database.Attach(workspace);
        var decision =
            await Domain.Workspaces.Workspaces.UpdateWorkspaceDisplayName(
                workspace,
                expectedRevision,
                displayName,
                audit,
                cancellation);
        if (decision is not WorkspaceMutationResult.Changed)
        {
            return decision;
        }

        try
        {
            await database.SaveChangesAsync(queryCancellation);
            return decision;
        }
        catch (DbUpdateConcurrencyException)
        {
            return new WorkspaceMutationResult.RevisionMismatch();
        }
    }
}
