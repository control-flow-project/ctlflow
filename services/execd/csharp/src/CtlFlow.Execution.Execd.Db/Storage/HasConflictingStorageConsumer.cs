using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Storage;

public static partial class StorageBindings
{
    public static async Task<bool> HasConflictingStorageConsumer(
        ExecutionDatabase database,
        PlacementId placementId,
        AppId appId,
        IReadOnlyList<PersistentStorage> storage,
        WorkloadId? excludedWorkloadId,
        CancellationToken cancellation)
    {
        if (storage.Count == 0)
        {
            return false;
        }

        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var placementIdValue = placementId.Value;
        var appIdValue = appId.Value;
        var storageIds = storage
            .Select(item => item.StorageId.Value)
            .ToHashSet(StringComparer.Ordinal);
        var excludedId = excludedWorkloadId?.Value;
        var continuous = (int)WorkloadMode.Continuous;
        var active = (int)DesiredState.Active;
        var suspended = (int)RealizationPhase.Suspended;
        var retired = (int)RealizationPhase.Retired;
        var queryCancellation = cancellation;
        var activeWorkloads = await context.WorkloadStorage
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "PlacementId")
                    == placementIdValue
                && EF.Property<string>(item, "AppId") == appIdValue)
            .Join(
                context.Workloads.AsNoTracking(),
                item => EF.Property<string>(item, "WorkloadId"),
                item => EF.Property<string>(item, "WorkloadId"),
                (selection, workload) => new
                {
                    StorageId =
                        EF.Property<string>(selection, "StorageId"),
                    Workload = workload
                })
            .Where(item =>
                EF.Property<string>(item.Workload, "WorkloadId")
                    != excludedId
                && EF.Property<int>(item.Workload, "Mode") == continuous
                && (EF.Property<int>(item.Workload, "DesiredState")
                        == active
                    || (EF.Property<int>(item.Workload, "RealizationPhase")
                            != suspended
                        && EF.Property<int>(item.Workload, "RealizationPhase")
                            != retired)))
            .Select(item => item.StorageId)
            .ToListAsync(queryCancellation);
        if (activeWorkloads.Any(storageIds.Contains))
        {
            return true;
        }

        var succeeded = (int)RunPhase.Succeeded;
        var failed = (int)RunPhase.Failed;
        var cancelled = (int)RunPhase.Cancelled;
        var activeRuns = await context.RunStorage
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "PlacementId")
                    == placementIdValue
                && EF.Property<string>(item, "AppId") == appIdValue)
            .Join(
                context.Runs.AsNoTracking(),
                item => EF.Property<string>(item, "RunId"),
                item => EF.Property<string>(item, "RunId"),
                (selection, run) => new
                {
                    StorageId =
                        EF.Property<string>(selection, "StorageId"),
                    Run = run
                })
            .Where(item =>
                EF.Property<int>(item.Run, "Phase") != succeeded
                && EF.Property<int>(item.Run, "Phase") != failed
                && EF.Property<int>(item.Run, "Phase") != cancelled)
            .Select(item => item.StorageId)
            .ToListAsync(queryCancellation);
        return activeRuns.Any(storageIds.Contains);
    }
}
