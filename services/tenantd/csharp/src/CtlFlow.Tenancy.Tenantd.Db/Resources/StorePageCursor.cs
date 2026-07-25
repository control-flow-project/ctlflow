using System.Data;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Tenancy.Tenantd.Db.Identifiers.StorageIdentifiers;
using static CtlFlow.Tenancy.Tenantd.Db.Sequences.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Db.Resources;

internal static partial class ResourcePages
{
    internal static async Task<PageToken?> StorePageCursor(
        IDbContextFactory<TenantDbContext> databaseContexts,
        int resourceKind,
        RequestActor actor,
        RequestDigest visibility,
        string? tenantFilter,
        string lastResourceId,
        ResourceEventCursor snapshot,
        PageCursorLifetime lifetime,
        UtcInstant now,
        CancellationToken cancellation)
    {
        await using var database = await databaseContexts.CreateDbContextAsync(
            cancellation);
        var queryCancellation = cancellation;
        await using var transaction = await database.Database
            .BeginTransactionAsync(IsolationLevel.Serializable, cancellation);
        var currentValue = await database.ResourceEventSequences
            .AsNoTracking()
            .Where(value => value.SequenceId == 1)
            .Select(value => value.CurrentSequence)
            .SingleAsync(queryCancellation);
        var current = ResourceEventCursor.FromStorage(currentValue);
        if (current != snapshot)
        {
            await transaction.RollbackAsync(cancellation);
            return null;
        }

        var pageToken = CreateStorageId("page");
        database.PageCursors.Add(new PageCursor(
            pageToken,
            resourceKind,
            actor.Value,
            visibility.Value,
            tenantFilter,
            lastResourceId,
            snapshot.Value,
            checked(
                now.UnixMilliseconds
                + (long)lifetime.Value.TotalMilliseconds)));
        await database.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        return PageToken.FromStorage(pageToken);
    }
}
