using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Tenancy.Tenantd.Db.Tenants;

internal static partial class TenantResources
{
    internal static async Task<TenantResource> LoadTenantResourceEvent(
        IDbContextFactory<TenantDbContext> databaseContexts,
        ResourceEventSequence eventSequence,
        CancellationToken cancellation)
    {
        var result = await Tenants.ReadTenantResourceEvents(
            databaseContexts,
            ResourceEventCursor.FromStorage(eventSequence.Value - 1),
            cancellation);
        if (result is not ResourceWatchReadResult<TenantResource>.Batch batch)
        {
            throw new InvalidOperationException(
                "An idempotency result event is no longer retained");
        }

        return batch.Events.Single(value =>
            value.Sequence == eventSequence).Resource;
    }
}
