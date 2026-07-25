using System.Data;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Identifiers.StorageIdentifiers;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static partial class LifecycleWork
{
    internal static async Task<PageToken?> StoreLifecyclePageCursor(
        IDbContextFactory<TenantDbContext> databaseContexts,
        LifecycleStepKey stepKey,
        RequestActor actor,
        long lastDeliverySequence,
        LifecycleDeliveryCursor snapshot,
        PageCursorLifetime lifetime,
        UtcInstant now,
        CancellationToken cancellation)
    {
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await using var transaction = await database.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellation);
        var currentValue = await database.LifecycleDeliverySequences
            .AsNoTracking()
            .Where(value => value.SequenceId == 1)
            .Select(value => value.CurrentSequence)
            .SingleAsync(queryCancellation);
        var current = LifecycleDeliveryCursor.FromStorage(currentValue);
        if (current != snapshot)
        {
            await transaction.RollbackAsync(cancellation);
            return null;
        }

        var pageToken = CreateStorageId("work");
        database.LifecyclePageCursors.Add(new LifecyclePageCursor(
            pageToken,
            (int)stepKey,
            actor.Value,
            lastDeliverySequence,
            snapshot.Value,
            checked(
                now.UnixMilliseconds
                + (long)lifetime.Value.TotalMilliseconds)));
        await database.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        return PageToken.FromStorage(pageToken);
    }
}
