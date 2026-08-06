using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Naming;
using CtlFlow.Execution.Execd.Domain.Operations;
using CtlFlow.Execution.Execd.Domain.Workloads;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Workloads;

public static partial class Workloads
{
    // Reads the retained facts behind one authenticated Workload
    // ServiceAccount subject and one requested operation.
    //
    // Subject, operation membership, Workload, App, Package, and the complete
    // Placement ancestry are read on one context in one transaction, so facts
    // cannot combine revisions. This operation only maps retained state; the
    // Domain function decides authority.
    public static async Task<WorkloadOperationBinding?>
        ResolveWorkloadOperationBinding(
            ExecutionDatabase database,
            string serviceAccountSubject,
            OperationToken operation,
            CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "resolve_workload_operation_binding");
        cancellation.ThrowIfCancellationRequested();
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var subject = serviceAccountSubject;
        var requestedOperation = operation.Value;
        var queryCancellation = cancellation;
        await using var transaction = await context.Database
            .BeginTransactionAsync(queryCancellation);

        var rows = await context.Workloads
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "ServiceAccountSubject")
                    == subject)
            .Select(item => new
            {
                WorkloadId = EF.Property<string>(item, "WorkloadId"),
                PlacementId = EF.Property<string>(item, "PlacementId"),
                AppId = EF.Property<string>(item, "AppId"),
                PackageId = EF.Property<string>(item, "PackageId"),
                DesiredState = EF.Property<int>(item, "DesiredState")
            })
            .Take(1)
            .ToListAsync(queryCancellation);
        var workload = rows.SingleOrDefault();
        if (workload is null)
        {
            return null;
        }

        var workloadId = workload.WorkloadId;
        var admitted = await context.WorkloadOperations
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "WorkloadId") == workloadId
                && EF.Property<string>(item, "Operation") == requestedOperation)
            .Select(item => EF.Property<string>(item, "Operation"))
            .Take(1)
            .ToListAsync(queryCancellation);

        // Placement rows are collected as raw state; mapping and every
        // decision happen after the reads, so nothing here interprets them.
        var placementRows = new List<PlacementStateRow>();
        var nextPlacementId = workload.PlacementId;
        while (nextPlacementId is not null)
        {
            if (placementRows.Count
                >= Domain.Workloads.Workloads.MaximumPlacementChainLength)
            {
                // A longer ancestry than the model allows is unreadable
                // stored state, not an absent binding.
                throw StoredStateIsInvalid();
            }

            var placementId = nextPlacementId;
            var placements = await context.Placements
                .AsNoTracking()
                .Where(item =>
                    EF.Property<string>(item, "PlacementId")
                        == placementId)
                .Select(item => new
                {
                    TargetKind =
                        EF.Property<int>(item, "TargetKind"),
                    TenantId =
                        EF.Property<string?>(item, "TenantId"),
                    WorkspaceId =
                        EF.Property<string?>(item, "WorkspaceId"),
                    AccountPrincipalId = EF.Property<string?>(
                        item,
                        "AccountPrincipalId"),
                    DesiredState =
                        EF.Property<int>(item, "DesiredState"),
                    ParentPlacementId = EF.Property<string?>(
                        item,
                        "ParentPlacementId")
                })
                .Take(1)
                .ToListAsync(queryCancellation);
            var placement = placements.SingleOrDefault();
            if (placement is null)
            {
                // Referential integrity forbids a missing parent, so this is
                // unreadable stored state rather than a concealed absence.
                throw StoredStateIsInvalid();
            }

            placementRows.Add(new PlacementStateRow(
                placement.TargetKind,
                placement.TenantId,
                placement.WorkspaceId,
                placement.AccountPrincipalId,
                placement.DesiredState,
                placement.ParentPlacementId is not null));
            nextPlacementId = placement.ParentPlacementId;
        }

        return await Domain.Workloads.Workloads.DecideOperationBinding(
            MapBindingFacts(
                workload.AppId,
                workload.PackageId,
                workload.WorkloadId,
                workload.PlacementId,
                subject,
                workload.DesiredState,
                admitted.Count > 0,
                placementRows),
            cancellation);
    }

    private sealed record PlacementStateRow(
        int TargetKind,
        string? TenantId,
        string? WorkspaceId,
        string? AccountPrincipalId,
        int DesiredState,
        bool HasParent);

    // Retained state that cannot be mapped is unreadable state, never caller
    // input: it surfaces as dependency unavailability like every other
    // corrupt-row path.
    private static WorkloadBindingFacts MapBindingFacts(
        string appId,
        string packageId,
        string workloadId,
        string placementId,
        string serviceAccountSubject,
        int desiredState,
        bool operationAdmitted,
        IReadOnlyList<PlacementStateRow> placements)
    {
        try
        {
            var parsedWorkloadId = WorkloadId.Parse(workloadId);
            var parsedPlacementId = PlacementId.Parse(placementId);
            var expectedSubject = NativeNames.CreateServiceAccountSubject(
                parsedPlacementId,
                parsedWorkloadId);
            if (!string.Equals(
                    serviceAccountSubject,
                    expectedSubject,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "Stored Workload subject is invalid");
            }

            return new WorkloadBindingFacts(
                AppId.Parse(appId),
                PackageId.Parse(packageId),
                Placements.PlacementRows.ParseDesiredState(desiredState),
                operationAdmitted,
                placements.Select(row => new PlacementBindingFacts(
                    Placements.PlacementRows.MapTarget(
                        row.TargetKind,
                        row.TenantId,
                        row.WorkspaceId,
                        row.AccountPrincipalId),
                    Placements.PlacementRows.ParseDesiredState(
                        row.DesiredState),
                    row.HasParent)).ToArray());
        }
        catch (Exception failure) when (
            failure is ArgumentException
                or InvalidOperationException
                or OverflowException)
        {
            throw StoredStateIsInvalid();
        }
    }

    private static ExecutionException StoredStateIsInvalid() =>
        new(
            ExecutionError.Unavailable,
            "Stored Workload state is invalid");
}
