using CtlFlow.Tenancy.Tenantd.Domain.Caching;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

public static partial class Workspaces
{
    public static async Task<ResolveWorkspaceResult> QueryWorkspaceResolution(
        IDbContextFactory<TenantDbContext> databaseContexts,
        WorkspaceLookup lookup,
        CacheLifetime cacheLifetime,
        UtcInstant currentTime,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "resolve_workspace");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        var cacheExpiry = CacheExpiry.Calculate(currentTime, cacheLifetime);

        var tenantId = lookup.TenantId.Value;
        var workspaceAddress = lookup.Address.Value;

        var row = await database.WorkspaceAddressBindings
            .AsNoTracking()
            .Where(binding =>
                EF.Property<string>(binding, "_tenantId") == tenantId
                && EF.Property<string>(binding, "_workspaceAddress") == workspaceAddress
                && binding.IsActive)
            .Join(
                database.Workspaces
                    .AsNoTracking()
                    .Where(workspace =>
                        workspace.Lifecycle == LifecycleState.Active
                        && EF.Property<string>(workspace, "_tenantId") == tenantId),
                binding => EF.Property<string>(binding, "_workspaceId"),
                workspace => EF.Property<string>(workspace, "_id"),
                (binding, workspace) => new
                {
                    Id = EF.Property<string>(workspace, "_id"),
                    ParentTenantId = EF.Property<string>(workspace, "_tenantId"),
                    workspace.Lifecycle,
                    workspace.Revision,
                    binding.BindingGeneration
                })
            .Join(
                database.Tenants
                    .AsNoTracking()
                    .Where(tenant => tenant.Lifecycle == LifecycleState.Active),
                joined => joined.ParentTenantId,
                tenant => EF.Property<string>(tenant, "_id"),
                (joined, tenant) => new
                {
                    joined.Id,
                    joined.Lifecycle,
                    joined.Revision,
                    joined.BindingGeneration
                })
            .SingleOrDefaultAsync(queryCancellation);

        return row is null
            ? new ResolveWorkspaceResult.NotFound()
            : new ResolveWorkspaceResult.Found(
                new WorkspaceResolution(
                    WorkspaceId.FromStorage(row.Id),
                    row.Lifecycle,
                    row.Revision,
                    row.BindingGeneration,
                    cacheExpiry));
    }
}
