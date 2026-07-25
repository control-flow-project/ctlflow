using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

internal static partial class WorkspaceResources
{
    internal static async Task<WorkspaceResource> LoadWorkspaceResourceEvent(
        IDbContextFactory<TenantDbContext> databaseContexts,
        ResourceEventSequence eventSequence,
        CancellationToken cancellation)
    {
        await using var database =
            await databaseContexts.CreateDbContextAsync(cancellation);
        var queryCancellation = cancellation;
        var sequence = eventSequence.Value;
        var tenantId = await database.ResourceEvents
            .AsNoTracking()
            .Where(value =>
                value.EventSequence == sequence
                && value.ResourceKind == 2)
            .Select(value => value.TenantId)
            .SingleAsync(queryCancellation);
        var result = await Workspaces.ReadWorkspaceResourceEvents(
            databaseContexts,
            TenantId.FromStorage(tenantId),
            ResourceEventCursor.FromStorage(eventSequence.Value - 1),
            cancellation);
        if (result is not
            ResourceWatchReadResult<WorkspaceResource>.Batch batch)
        {
            throw new InvalidOperationException(
                "An idempotency result event is no longer retained");
        }

        return batch.Events.Single(value =>
            value.Sequence == eventSequence).Resource;
    }
}
