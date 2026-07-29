namespace CtlFlow.Execution.Execd.Domain.Placements;

public class Placement
{
    private Placement()
    {
    }

    private Placement(PlacementRecord record)
    {
        Apply(record);
    }

    internal void Apply(PlacementRecord record)
    {
        PlacementId = record.Id.Value;
        ParentPlacementId = record.ParentId?.Value;
        DesiredState = (int)record.DesiredState;
        AdmitContinuous = record.Constraints.AdmitContinuous;
        AdmitFinite = record.Constraints.AdmitFinite;
        MaxReplicas = checked((int)record.Constraints.MaxReplicas);
        MaxRunDurationSeconds = checked(
            (long)record.Constraints.MaxRunDurationSeconds);
        MaxRunAttempts = checked(
            (int)record.Constraints.MaxRunAttempts);
        MaxCpuMillis = checked((int)record.Constraints.MaxCpuMillis);
        MaxMemoryBytes = checked(
            (long)record.Constraints.MaxMemoryBytes);
        MaxStorageBytes = checked(
            (long)record.Constraints.MaxStorageBytes);
        Revision = record.Revision.Value;
        StatusRevision = record.Realization.StatusRevision.Value;
        ObservedRevision = record.Realization.ObservedRevision;
        RealizationPhase = (int)record.Realization.Phase;
        RealizationReason = (int)record.Realization.Reason;
        CreatedAtUnixMs = record.CreatedAt.UnixMilliseconds;
        UpdatedAtUnixMs = record.UpdatedAt.UnixMilliseconds;
        StatusUpdatedAtUnixMs =
            record.Realization.UpdatedAt.UnixMilliseconds;
        SetTarget(record.Target);
    }

    internal string PlacementId { get; set; } = null!;
    internal int TargetKind { get; set; }
    internal string? TenantId { get; set; }
    internal string? WorkspaceId { get; set; }
    internal string? AccountPrincipalId { get; set; }
    internal string? ParentPlacementId { get; set; }
    internal int DesiredState { get; set; }
    internal bool AdmitContinuous { get; set; }
    internal bool AdmitFinite { get; set; }
    internal int MaxReplicas { get; set; }
    internal long MaxRunDurationSeconds { get; set; }
    internal int MaxRunAttempts { get; set; }
    internal int MaxCpuMillis { get; set; }
    internal long MaxMemoryBytes { get; set; }
    internal long MaxStorageBytes { get; set; }
    internal long Revision { get; set; }
    internal long StatusRevision { get; set; }
    internal long ObservedRevision { get; set; }
    internal int RealizationPhase { get; set; }
    internal int RealizationReason { get; set; }
    internal long CreatedAtUnixMs { get; set; }
    internal long UpdatedAtUnixMs { get; set; }
    internal long StatusUpdatedAtUnixMs { get; set; }

    internal static Placement Restore(PlacementRecord record) =>
        new(record);

    internal static Placement RestoreStorage(
        string placementId,
        int targetKind,
        string? tenantId,
        string? workspaceId,
        string? accountPrincipalId,
        string? parentPlacementId,
        int desiredState,
        bool admitContinuous,
        bool admitFinite,
        int maxReplicas,
        long maxRunDurationSeconds,
        int maxRunAttempts,
        int maxCpuMillis,
        long maxMemoryBytes,
        long maxStorageBytes,
        long revision,
        long statusRevision,
        long observedRevision,
        int realizationPhase,
        int realizationReason,
        long createdAtUnixMs,
        long updatedAtUnixMs,
        long statusUpdatedAtUnixMs) =>
        new()
        {
            PlacementId = placementId,
            TargetKind = targetKind,
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            AccountPrincipalId = accountPrincipalId,
            ParentPlacementId = parentPlacementId,
            DesiredState = desiredState,
            AdmitContinuous = admitContinuous,
            AdmitFinite = admitFinite,
            MaxReplicas = maxReplicas,
            MaxRunDurationSeconds = maxRunDurationSeconds,
            MaxRunAttempts = maxRunAttempts,
            MaxCpuMillis = maxCpuMillis,
            MaxMemoryBytes = maxMemoryBytes,
            MaxStorageBytes = maxStorageBytes,
            Revision = revision,
            StatusRevision = statusRevision,
            ObservedRevision = observedRevision,
            RealizationPhase = realizationPhase,
            RealizationReason = realizationReason,
            CreatedAtUnixMs = createdAtUnixMs,
            UpdatedAtUnixMs = updatedAtUnixMs,
            StatusUpdatedAtUnixMs = statusUpdatedAtUnixMs
        };

    private void SetTarget(PlacementTarget target)
    {
        TargetKind = target switch
        {
            PlacementTarget.Global => 1,
            PlacementTarget.Tenant => 2,
            PlacementTarget.Workspace => 3,
            PlacementTarget.User => 4,
            _ => throw new InvalidOperationException(
                "Placement target is invalid")
        };
        TenantId = target switch
        {
            PlacementTarget.Tenant tenant => tenant.TenantId.Value,
            PlacementTarget.Workspace workspace =>
                workspace.TenantId.Value,
            PlacementTarget.User user => user.TenantId.Value,
            _ => null
        };
        WorkspaceId = target is PlacementTarget.Workspace workspaceTarget
            ? workspaceTarget.WorkspaceId.Value
            : null;
        AccountPrincipalId = target is PlacementTarget.User userTarget
            ? userTarget.AccountPrincipalId.Value
            : null;
    }
}

public class PlacementProvisioner
{
    internal string PlacementId { get; set; } = null!;
    internal string DependencyType { get; set; } = null!;
    internal string ProvisionerId { get; set; } = null!;
}
