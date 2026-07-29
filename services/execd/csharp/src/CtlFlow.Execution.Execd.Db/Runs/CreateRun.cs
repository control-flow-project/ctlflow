using CtlFlow.Execution.Execd.Domain.Auditing;
using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Workloads;
using Microsoft.EntityFrameworkCore;
using static CtlFlow.Execution.Execd.Db.Reconciliation.ReconciliationState;
using static CtlFlow.Execution.Execd.Db.Placements.Placements;
using static CtlFlow.Execution.Execd.Db.Runs.RunRows;
using static CtlFlow.Execution.Execd.Db.Workloads.Workloads;

namespace CtlFlow.Execution.Execd.Db.Runs;

public static partial class Runs
{
    public static async Task<MutationResult<RunRecord>> CreateRun(
        ExecutionDatabase database,
        RunId runId,
        WorkloadId workloadId,
        AuditContext audit,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "create_run");
        await using var lease =
            await database.AcquireMutation(cancellation);
        var existing = await LoadRun(database, runId, cancellation);
        var creation = await Domain.Runs.Runs.DecideRunCreation(
            existing,
            workloadId,
            cancellation);
        if (creation is RunCreationDecision.Current retained)
        {
            return new MutationResult<RunRecord>(
                retained.Run,
                null);
        }

        _ = creation as RunCreationDecision.Create
            ?? throw new InvalidOperationException(
                "Run creation decision is invalid");
        var workload = await LoadWorkload(
            database,
            workloadId,
            cancellation)
            ?? throw new ExecutionException(
                ExecutionError.NotFound,
                "Workload was not found");
        var placement = await LoadPlacement(
            database,
            workload.PlacementId,
            cancellation)
            ?? throw new ExecutionException(
                ExecutionError.Unavailable,
                "Workload Placement was not found");
        var placementLineage =
            await Db.Placements.Placements.LoadPlacementLineage(
            database,
            placement,
            cancellation);
        var storageBusy = false;
        if (workload.Storage.Count > 0)
        {
            storageBusy = await HasNonterminalRun(
                database,
                workloadId,
                cancellation);
        }

        await Domain.Runs.Runs.ValidateRunAdmission(
            workload,
            placementLineage,
            storageBusy,
            cancellation);
        var dependencyOptions = await LoadDependencyOptions(
            database,
            workload,
            cancellation);
        var created = await Domain.Runs.Runs.CreateRun(
            runId,
            workload,
            placement.Target,
            audit,
            cancellation);
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        await using var transaction =
            await context.Database.BeginTransactionAsync(cancellation);
        context.Runs.Add(created.Entity);
        context.RunConfigTargets.AddRange(
            CreateConfigTargets(runId, workload));
        context.RunStorage.AddRange(
            CreateStorage(runId, workload));
        CopyRunDependencies(
            context,
            runId,
            workload,
            dependencyOptions);
        await context.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        return new MutationResult<RunRecord>(
            created.Run,
            created.Audit);
    }

    private static async Task<bool> HasNonterminalRun(
        ExecutionDatabase database,
        WorkloadId workloadId,
        CancellationToken cancellation)
    {
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var workloadIdValue = workloadId.Value;
        var succeeded = (int)RunPhase.Succeeded;
        var failed = (int)RunPhase.Failed;
        var cancelled = (int)RunPhase.Cancelled;
        var queryCancellation = cancellation;
        var rows = await context.Runs
            .AsNoTracking()
            .Where(item =>
                    EF.Property<string>(item, "WorkloadId")
                        == workloadIdValue
                    && EF.Property<int>(item, "Phase") != succeeded
                    && EF.Property<int>(item, "Phase") != failed
                    && EF.Property<int>(item, "Phase") != cancelled)
            .Select(item => new
            {
                RunId = EF.Property<string>(item, "RunId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        return rows.Count != 0;
    }

    private static async Task<IReadOnlyDictionary<
        (ComponentId ComponentId, DependencyName DependencyName),
        byte[]>> LoadDependencyOptions(
        ExecutionDatabase database,
        WorkloadRecord workload,
        CancellationToken cancellation)
    {
        var options = new Dictionary<
            (ComponentId ComponentId, DependencyName DependencyName),
            byte[]>();
        foreach (var dependency in workload.Dependencies)
        {
            using var lease = await ReadDependencyOptions(
                database,
                workload.Id,
                dependency.Selection.ComponentId,
                dependency.Selection.Name,
                cancellation);
            options.Add(
                (
                    dependency.Selection.ComponentId,
                    dependency.Selection.Name),
                lease.Content.ToArray());
        }

        return options;
    }
}
