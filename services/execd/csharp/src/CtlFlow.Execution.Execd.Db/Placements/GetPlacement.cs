using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Execution.Execd.Db.Placements;

public static partial class Placements
{
    public static async Task<PlacementRecord> GetPlacement(
        ExecutionDatabase database,
        PlacementId placementId,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "get_placement");
        return await LoadPlacement(database, placementId, cancellation)
            ?? throw new ExecutionException(
                ExecutionError.NotFound,
                "Placement was not found");
    }

    internal static async Task<PlacementRecord?> LoadPlacement(
        ExecutionDatabase database,
        PlacementId placementId,
        CancellationToken cancellation)
    {
        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var id = placementId.Value;
        var queryCancellation = cancellation;
        var row = await context.Placements
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "PlacementId") == id)
            .Select(item => new
            {
                PlacementId =
                    EF.Property<string>(item, "PlacementId"),
                TargetKind = EF.Property<int>(item, "TargetKind"),
                TenantId = EF.Property<string?>(item, "TenantId"),
                WorkspaceId =
                    EF.Property<string?>(item, "WorkspaceId"),
                AccountPrincipalId = EF.Property<string?>(
                    item,
                    "AccountPrincipalId"),
                ParentPlacementId = EF.Property<string?>(
                    item,
                    "ParentPlacementId"),
                DesiredState =
                    EF.Property<int>(item, "DesiredState"),
                AdmitContinuous =
                    EF.Property<bool>(item, "AdmitContinuous"),
                AdmitFinite =
                    EF.Property<bool>(item, "AdmitFinite"),
                MaxReplicas =
                    EF.Property<int>(item, "MaxReplicas"),
                MaxRunDurationSeconds = EF.Property<long>(
                    item,
                    "MaxRunDurationSeconds"),
                MaxRunAttempts =
                    EF.Property<int>(item, "MaxRunAttempts"),
                MaxCpuMillis =
                    EF.Property<int>(item, "MaxCpuMillis"),
                MaxMemoryBytes =
                    EF.Property<long>(item, "MaxMemoryBytes"),
                MaxStorageBytes =
                    EF.Property<long>(item, "MaxStorageBytes"),
                Revision = EF.Property<long>(item, "Revision"),
                StatusRevision =
                    EF.Property<long>(item, "StatusRevision"),
                ObservedRevision =
                    EF.Property<long>(item, "ObservedRevision"),
                RealizationPhase =
                    EF.Property<int>(item, "RealizationPhase"),
                RealizationReason =
                    EF.Property<int>(item, "RealizationReason"),
                CreatedAtUnixMs =
                    EF.Property<long>(item, "CreatedAtUnixMs"),
                UpdatedAtUnixMs =
                    EF.Property<long>(item, "UpdatedAtUnixMs"),
                StatusUpdatedAtUnixMs = EF.Property<long>(
                    item,
                    "StatusUpdatedAtUnixMs")
            })
            .SingleOrDefaultAsync(queryCancellation);
        if (row is null)
        {
            return null;
        }

        var provisioners = await context.PlacementProvisioners
            .AsNoTracking()
            .Where(item =>
                EF.Property<string>(item, "PlacementId") == id)
            .OrderBy(item =>
                EF.Property<string>(item, "DependencyType"))
            .Select(item => new
            {
                PlacementId =
                    EF.Property<string>(item, "PlacementId"),
                DependencyType =
                    EF.Property<string>(item, "DependencyType"),
                ProvisionerId =
                    EF.Property<string>(item, "ProvisionerId")
            })
            .ToListAsync(queryCancellation);
        var placement = Placement.RestoreStorage(
            row.PlacementId,
            row.TargetKind,
            row.TenantId,
            row.WorkspaceId,
            row.AccountPrincipalId,
            row.ParentPlacementId,
            row.DesiredState,
            row.AdmitContinuous,
            row.AdmitFinite,
            row.MaxReplicas,
            row.MaxRunDurationSeconds,
            row.MaxRunAttempts,
            row.MaxCpuMillis,
            row.MaxMemoryBytes,
            row.MaxStorageBytes,
            row.Revision,
            row.StatusRevision,
            row.ObservedRevision,
            row.RealizationPhase,
            row.RealizationReason,
            row.CreatedAtUnixMs,
            row.UpdatedAtUnixMs,
            row.StatusUpdatedAtUnixMs);
        return PlacementRows.MapPlacement(
            placement,
            provisioners.Select(item => new PlacementProvisioner
            {
                PlacementId = item.PlacementId,
                DependencyType = item.DependencyType,
                ProvisionerId = item.ProvisionerId
            }).ToArray());
    }
}
