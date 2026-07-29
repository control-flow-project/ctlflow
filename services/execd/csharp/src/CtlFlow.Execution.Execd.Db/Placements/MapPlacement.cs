using CtlFlow.Execution.Execd.Db.Persistence;
using CtlFlow.Execution.Execd.Domain.Errors;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Db.Placements;

internal static partial class PlacementRows
{
    internal static PlacementRecord MapPlacement(
        Placement row,
        IReadOnlyList<PlacementProvisioner> provisioners)
    {
        try
        {
            return new PlacementRecord(
                PlacementId.Parse(row.PlacementId),
                MapTarget(row),
                row.ParentPlacementId is null
                    ? null
                    : PlacementId.Parse(row.ParentPlacementId),
                PlacementConstraints.Create(
                    row.AdmitContinuous,
                    row.AdmitFinite,
                    (uint)row.MaxReplicas,
                    (ulong)row.MaxRunDurationSeconds,
                    (uint)row.MaxRunAttempts,
                    (uint)row.MaxCpuMillis,
                    (ulong)row.MaxMemoryBytes,
                    (ulong)row.MaxStorageBytes,
                    provisioners.Select(item =>
                        new DependencyProvisionerSelection(
                            DependencyType.Parse(item.DependencyType),
                            ProvisionerId.Parse(item.ProvisionerId)))),
                ParseDesiredState(row.DesiredState),
                Revision.FromStorage(row.Revision),
                new RealizationStatus(
                    Revision.FromStorage(row.StatusRevision),
                    row.ObservedRevision,
                    ParseRealizationPhase(row.RealizationPhase),
                    ParseRealizationReason(row.RealizationReason),
                    UtcInstant.FromStorage(row.StatusUpdatedAtUnixMs)),
                UtcInstant.FromStorage(row.CreatedAtUnixMs),
                UtcInstant.FromStorage(row.UpdatedAtUnixMs));
        }
        catch (Exception exception) when (
            exception is ArgumentException or InvalidOperationException)
        {
            throw new ExecutionException(
                ExecutionError.Unavailable,
                "Stored Placement state is invalid");
        }
    }

    internal static PlacementTarget MapTarget(Placement row) =>
        MapTarget(
            row.TargetKind,
            row.TenantId,
            row.WorkspaceId,
            row.AccountPrincipalId);

    internal static PlacementTarget MapTarget(
        int targetKind,
        string? tenantId,
        string? workspaceId,
        string? accountPrincipalId) =>
        targetKind switch
        {
            1 when tenantId is null
                && workspaceId is null
                && accountPrincipalId is null =>
                new PlacementTarget.Global(),
            2 when tenantId is not null
                && workspaceId is null
                && accountPrincipalId is null =>
                new PlacementTarget.Tenant(TenantId.Parse(tenantId)),
            3 when tenantId is not null
                && workspaceId is not null
                && accountPrincipalId is null =>
                new PlacementTarget.Workspace(
                    TenantId.Parse(tenantId),
                    WorkspaceId.Parse(workspaceId)),
            4 when tenantId is not null
                && workspaceId is null
                && accountPrincipalId is not null =>
                new PlacementTarget.User(
                    TenantId.Parse(tenantId),
                    PrincipalId.ParseAccount(accountPrincipalId)),
            _ => throw new InvalidOperationException(
                "Stored Placement target is invalid")
        };

    internal static int TargetKind(PlacementTarget target) =>
        target switch
        {
            PlacementTarget.Global => 1,
            PlacementTarget.Tenant => 2,
            PlacementTarget.Workspace => 3,
            PlacementTarget.User => 4,
            _ => throw new InvalidOperationException("Placement target is invalid")
        };

    internal static DesiredState ParseDesiredState(int value) =>
        value switch
        {
            1 => DesiredState.Active,
            2 => DesiredState.Suspended,
            3 => DesiredState.Retired,
            _ => throw new InvalidOperationException("Desired state is invalid")
        };

    internal static RealizationPhase ParseRealizationPhase(int value) =>
        value switch
        {
            1 => RealizationPhase.Pending,
            2 => RealizationPhase.Ready,
            3 => RealizationPhase.Suspended,
            4 => RealizationPhase.Degraded,
            5 => RealizationPhase.Retired,
            _ => throw new InvalidOperationException("Realization phase is invalid")
        };

    internal static RealizationReason ParseRealizationReason(int value) =>
        value switch
        {
            1 => RealizationReason.None,
            2 => RealizationReason.PlacementNotReady,
            3 => RealizationReason.BindingUnavailable,
            4 => RealizationReason.KubernetesUnavailable,
            5 => RealizationReason.RealizationRejected,
            6 => RealizationReason.OwnershipConflict,
            7 => RealizationReason.StorageUnavailable,
            8 => RealizationReason.ExecutionUnready,
            _ => throw new InvalidOperationException("Realization reason is invalid")
        };
}
