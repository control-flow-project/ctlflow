using CtlFlow.Execution.Execd.Domain.Auditing;
using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Workloads;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Placements;

public static partial class Placements
{
    public static async Task<MutationResult<PlacementRecord>> DeclarePlacement(
        ExecutionDatabase database,
        PlacementId placementId,
        PlacementTarget target,
        PlacementId? parentId,
        PlacementConstraints constraints,
        DesiredState desiredState,
        Revision? expectedRevision,
        AuditContext audit,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "declare_placement");
        await using var lease = await database.AcquireMutation(cancellation);
        var existing = await LoadPlacement(
            database,
            placementId,
            cancellation);
        var parent = parentId is null
            ? null
            : await LoadPlacement(
                database,
                parentId,
                cancellation)
                ?? throw new ExecutionException(
                    ExecutionError.NotFound,
                    "Parent Placement was not found");

        await Domain.Placements.Placements.ValidatePlacementParent(
            target,
            constraints,
            parent,
            cancellation);

        var facts = existing is null
            ? new PlacementUpdateFacts([], [], false)
            : await LoadPlacementUpdateFacts(
                database,
                placementId,
                cancellation);
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        Placement? entity = null;
        if (existing is not null)
        {
            entity = await Domain.Placements.Placements
                .RestorePlacement(existing, cancellation);
            context.Attach(entity);
        }

        var decision = await Domain.Placements.Placements
            .DecidePlacementDeclaration(
                entity,
                existing,
                placementId,
                target,
                parentId,
                constraints,
                desiredState,
                expectedRevision,
                facts,
                audit,
                cancellation);
        if (decision is PlacementDeclarationDecision.Current retained)
        {
            return new MutationResult<PlacementRecord>(
                retained.Placement,
                null);
        }

        var changed = decision as PlacementDeclarationDecision.Changed
            ?? throw new InvalidOperationException(
                "Placement declaration decision is invalid");
        await using var transaction =
            await context.Database.BeginTransactionAsync(cancellation);
        if (changed.IsCreate)
        {
            context.Placements.Add(changed.Entity);
        }
        else
        {
            context.PlacementProvisioners.RemoveRange(
                CreateProvisionerRows(
                    placementId,
                    existing!.Constraints));
        }

        context.PlacementProvisioners.AddRange(
            CreateProvisionerRows(placementId, constraints));
        await context.SaveChangesAsync(cancellation);
        await transaction.CommitAsync(cancellation);
        return new MutationResult<PlacementRecord>(
            changed.Placement,
            changed.Audit);
    }

    private static PlacementProvisioner[] CreateProvisionerRows(
        PlacementId placementId,
        PlacementConstraints constraints) =>
        constraints.Provisioners.Select(item => new PlacementProvisioner
        {
            PlacementId = placementId.Value,
            DependencyType = item.DependencyType.Value,
            ProvisionerId = item.ProvisionerId.Value
        }).ToArray();

    private static async Task<PlacementUpdateFacts>
        LoadPlacementUpdateFacts(
        ExecutionDatabase database,
        PlacementId placementId,
        CancellationToken cancellation)
    {
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var placementIdValue = placementId.Value;
        var retiredState = (int)DesiredState.Retired;
        var queryCancellation = cancellation;
        var childIds = await context.Placements
            .AsNoTracking()
            .Where(row =>
                EF.Property<string?>(row, "ParentPlacementId")
                    == placementIdValue
                && EF.Property<int>(row, "DesiredState") != retiredState)
            .OrderBy(row =>
                EF.Property<string>(row, "PlacementId"))
            .Select(row =>
                new
                {
                    PlacementId =
                        EF.Property<string>(row, "PlacementId")
                })
            .ToListAsync(queryCancellation);
        var children = new List<PlacementRecord>(childIds.Count);
        foreach (var child in childIds)
        {
            children.Add(
                await LoadPlacement(
                    database,
                    PlacementId.Parse(child.PlacementId),
                    cancellation)
                ?? throw new InvalidOperationException(
                    "Placement child was not retained"));
        }

        var workloadIds = await context.Workloads
            .AsNoTracking()
            .Where(row =>
                EF.Property<string>(row, "PlacementId")
                    == placementIdValue
                && EF.Property<int>(row, "DesiredState") != retiredState)
            .OrderBy(row =>
                EF.Property<string>(row, "WorkloadId"))
            .Select(row =>
                new
                {
                    WorkloadId =
                        EF.Property<string>(row, "WorkloadId")
                })
            .ToListAsync(queryCancellation);
        var workloads = new List<WorkloadRecord>(workloadIds.Count);
        foreach (var workload in workloadIds)
        {
            workloads.Add(
                await Db.Workloads.Workloads.LoadWorkload(
                    database,
                    WorkloadId.Parse(workload.WorkloadId),
                    cancellation)
                ?? throw new InvalidOperationException(
                    "Placement Workload was not retained"));
        }

        var succeeded = (int)RunPhase.Succeeded;
        var failed = (int)RunPhase.Failed;
        var cancelled = (int)RunPhase.Cancelled;
        var runRows = await context.Runs
            .AsNoTracking()
            .Where(row =>
                    EF.Property<string>(row, "PlacementId")
                        == placementIdValue
                    && EF.Property<int>(row, "Phase") != succeeded
                    && EF.Property<int>(row, "Phase") != failed
                    && EF.Property<int>(row, "Phase") != cancelled)
            .Select(row => new
            {
                RunId = EF.Property<string>(row, "RunId")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        return new PlacementUpdateFacts(
            children,
            workloads,
            runRows.Count != 0);
    }
}
