using CtlFlow.Tenancy.Tenantd.Domain.Caching;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

public static partial class Lifecycles
{
    public static async Task<GetLifecycleResult> QueryLifecycle(
        IDbContextFactory<TenantDbContext> databaseContexts,
        LifecycleTarget target,
        CacheLifetime cacheLifetime,
        UtcInstant currentTime,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var dbActivity = TenantDbTelemetry.StartOperation(
            "query_lifecycle");
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        var cacheExpiry = CacheExpiry.Calculate(
            currentTime,
            cacheLifetime);

        if (target is LifecycleTarget.Tenant tenantTarget)
        {
            var tenantId = tenantTarget.TenantId.Value;
            var row = await database.Tenants
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_id") == tenantId)
                .Select(value => new
                {
                    value.Lifecycle,
                    Revision = value.Revision.Value,
                    Generation = value.ProvisioningGeneration.Value,
                    OperationId = EF.Property<string?>(
                        value,
                        "_currentOperationId")
                })
                .SingleOrDefaultAsync(queryCancellation);
            return row is null
                ? new GetLifecycleResult.NotFound()
                : new GetLifecycleResult.Found(new LifecycleFact(
                    target,
                    row.Lifecycle,
                    null,
                    row.Revision,
                    row.Generation,
                    row.OperationId is null
                        ? null
                        : LifecycleOperationId.FromStorage(row.OperationId),
                    cacheExpiry));
        }

        if (target is LifecycleTarget.Workspace workspaceTarget)
        {
            var tenantId = workspaceTarget.TenantId.Value;
            var workspaceId = workspaceTarget.WorkspaceId.Value;
            var row = await database.Workspaces
                .AsNoTracking()
                .Where(value =>
                    EF.Property<string>(value, "_id") == workspaceId
                    && EF.Property<string>(value, "_tenantId") == tenantId)
                .Join(
                    database.Tenants.AsNoTracking(),
                    workspace => EF.Property<string>(
                        workspace,
                        "_tenantId"),
                    tenant => EF.Property<string>(tenant, "_id"),
                    (workspace, tenant) => new
                    {
                        workspace.Lifecycle,
                        ParentLifecycle = tenant.Lifecycle,
                        Revision = workspace.Revision.Value,
                        Generation =
                            workspace.ProvisioningGeneration.Value,
                        OperationId = EF.Property<string?>(
                            workspace,
                            "_currentOperationId")
                    })
                .SingleOrDefaultAsync(queryCancellation);
            return row is null
                ? new GetLifecycleResult.NotFound()
                : new GetLifecycleResult.Found(new LifecycleFact(
                    target,
                    row.Lifecycle,
                    row.ParentLifecycle,
                    row.Revision,
                    row.Generation,
                    row.OperationId is null
                        ? null
                        : LifecycleOperationId.FromStorage(row.OperationId),
                    cacheExpiry));
        }

        throw new InvalidOperationException("Lifecycle target is invalid");
    }
}
