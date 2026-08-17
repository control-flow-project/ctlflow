using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Storage;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Storage;

public static partial class StorageBindings
{
    public static async Task<IReadOnlyList<AppStorageBindingFact>>
        LoadAppStorageBindings(
            ExecutionDatabase database,
            PlacementId placementId,
            AppId appId,
            IReadOnlyList<StorageId> requested,
            CancellationToken cancellation)
    {
        if (requested.Count == 0)
        {
            return [];
        }

        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var placementIdValue = placementId.Value;
        var appIdValue = appId.Value;
        var storageIds = requested
            .Select(item => item.Value)
            .ToHashSet(StringComparer.Ordinal);
        var queryCancellation = cancellation;
        var rows = await context.AppStorageBindings
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "PlacementId")
                    == placementIdValue
                && EF.Property<string>(item, "AppId") == appIdValue)
            .OrderBy(item => EF.Property<string>(item, "StorageId"))
            .Select(item => new
            {
                StorageId = EF.Property<string>(item, "StorageId"),
                CapacityBytes = EF.Property<long>(item, "CapacityBytes")
            })
            .ToListAsync(queryCancellation);
        return rows
            .Where(item => storageIds.Contains(item.StorageId))
            .Select(item => new AppStorageBindingFact(
                StorageId.Parse(item.StorageId),
                item.CapacityBytes))
            .ToArray();
    }
}
