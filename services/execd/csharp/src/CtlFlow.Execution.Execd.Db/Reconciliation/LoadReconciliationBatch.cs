using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Execution.Execd.Db.Placements.Placements;
using static CtlFlow.Execution.Execd.Db.Runs.Runs;
using static CtlFlow.Execution.Execd.Db.Workloads.Workloads;

namespace CtlFlow.Execution.Execd.Db.Reconciliation;

public static partial class ReconciliationState
{
    private const int BatchSize = 128;

    public static async Task<ReconciliationBatch>
        LoadReconciliationBatch(
            ExecutionDatabase database,
            bool includeStable,
            CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "load_reconciliation_batch");
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var retiredState = (int)DesiredState.Retired;
        var pendingPhase = (int)RealizationPhase.Pending;
        var degradedPhase = (int)RealizationPhase.Degraded;
        var retiredPhase = (int)RealizationPhase.Retired;
        var succeededRun = (int)RunPhase.Succeeded;
        var failedRun = (int)RunPhase.Failed;
        var cancelledRun = (int)RunPhase.Cancelled;
        var batchSize = BatchSize;
        var queryCancellation = cancellation;
        var placementIds = includeStable
            ? await context.Placements
                .AsNoTracking()
                .Where(item =>
                    EF.Property<int>(item, "DesiredState")
                        != retiredState
                    || EF.Property<int>(item, "RealizationPhase")
                        != retiredPhase)
                .OrderBy(item =>
                    EF.Property<long>(item, "StatusUpdatedAtUnixMs"))
                .ThenBy(item =>
                    EF.Property<string>(item, "PlacementId"))
                .Select(item =>
                    EF.Property<string>(item, "PlacementId"))
                .Take(batchSize)
                .ToListAsync(queryCancellation)
            : await context.Placements
                .AsNoTracking()
                .Where(item =>
                    (EF.Property<int>(item, "DesiredState")
                            != retiredState
                        || EF.Property<int>(item, "RealizationPhase")
                            != retiredPhase)
                    && (EF.Property<long>(item, "ObservedRevision")
                            != EF.Property<long>(item, "Revision")
                        || EF.Property<int>(item, "RealizationPhase")
                            == pendingPhase
                        || EF.Property<int>(item, "RealizationPhase")
                            == degradedPhase
                        || (EF.Property<int>(item, "DesiredState")
                                == retiredState
                            && EF.Property<int>(item, "RealizationPhase")
                                != retiredPhase)))
                .OrderBy(item =>
                    EF.Property<long>(item, "StatusUpdatedAtUnixMs"))
                .ThenBy(item =>
                    EF.Property<string>(item, "PlacementId"))
                .Select(item =>
                    EF.Property<string>(item, "PlacementId"))
                .Take(batchSize)
                .ToListAsync(queryCancellation);
        var workloadIds = includeStable
            ? await context.Workloads
                .AsNoTracking()
                .Where(item =>
                    EF.Property<int>(item, "DesiredState")
                        != retiredState
                    || EF.Property<int>(item, "RealizationPhase")
                        != retiredPhase)
                .OrderBy(item =>
                    EF.Property<long>(item, "StatusUpdatedAtUnixMs"))
                .ThenBy(item =>
                    EF.Property<string>(item, "WorkloadId"))
                .Select(item =>
                    EF.Property<string>(item, "WorkloadId"))
                .Take(batchSize)
                .ToListAsync(queryCancellation)
            : await context.Workloads
                .AsNoTracking()
                .Where(item =>
                    (EF.Property<int>(item, "DesiredState")
                            != retiredState
                        || EF.Property<int>(item, "RealizationPhase")
                            != retiredPhase)
                    && (EF.Property<long>(item, "ObservedRevision")
                            != EF.Property<long>(item, "Revision")
                        || EF.Property<int>(item, "RealizationPhase")
                            == pendingPhase
                        || EF.Property<int>(item, "RealizationPhase")
                            == degradedPhase
                        || (EF.Property<int>(item, "DesiredState")
                                == retiredState
                            && EF.Property<int>(item, "RealizationPhase")
                                != retiredPhase)))
                .OrderBy(item =>
                    EF.Property<long>(item, "StatusUpdatedAtUnixMs"))
                .ThenBy(item =>
                    EF.Property<string>(item, "WorkloadId"))
                .Select(item =>
                    EF.Property<string>(item, "WorkloadId"))
                .Take(batchSize)
                .ToListAsync(queryCancellation);
        var runIds = await context.Runs
            .AsNoTracking()
            .Where(item =>
                EF.Property<int>(item, "Phase") != succeededRun
                && EF.Property<int>(item, "Phase") != failedRun
                && EF.Property<int>(item, "Phase")
                    != cancelledRun)
            .OrderBy(item =>
                EF.Property<long>(item, "UpdatedAtUnixMs"))
            .ThenBy(item => EF.Property<string>(item, "RunId"))
            .Select(item => EF.Property<string>(item, "RunId"))
            .Take(batchSize)
            .ToListAsync(queryCancellation);

        var placements = new List<
            Domain.Placements.PlacementRecord>(placementIds.Count);
        foreach (var id in placementIds)
        {
            placements.Add(
                await LoadPlacement(
                    database,
                    PlacementId.Parse(id),
                    queryCancellation)
                ?? throw new InvalidOperationException(
                    "Placement disappeared during reconciliation"));
        }

        var workloads = new List<
            Domain.Workloads.WorkloadRecord>(workloadIds.Count);
        foreach (var id in workloadIds)
        {
            workloads.Add(
                await LoadWorkload(
                    database,
                    WorkloadId.Parse(id),
                    queryCancellation)
                ?? throw new InvalidOperationException(
                    "Workload disappeared during reconciliation"));
        }

        var runs = new List<Domain.Runs.RunRecord>(runIds.Count);
        foreach (var id in runIds)
        {
            runs.Add(
                await LoadRun(
                    database,
                    RunId.Parse(id),
                    queryCancellation)
                ?? throw new InvalidOperationException(
                    "Run disappeared during reconciliation"));
        }

        return new ReconciliationBatch(
            placements,
            workloads,
            runs);
    }
}
