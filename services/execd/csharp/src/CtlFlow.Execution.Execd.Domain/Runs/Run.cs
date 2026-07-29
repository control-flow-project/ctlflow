namespace CtlFlow.Execution.Execd.Domain.Runs;

using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;

public class Run
{
    private Run()
    {
    }

    internal string RunId { get; set; } = null!;
    internal string WorkloadId { get; set; } = null!;
    internal long WorkloadRevision { get; set; }
    internal string PlacementId { get; set; } = null!;
    internal int TargetKind { get; set; }
    internal string? TenantId { get; set; }
    internal string? WorkspaceId { get; set; }
    internal string? AccountPrincipalId { get; set; }
    internal string? ActorPrincipalId { get; set; }
    internal string AppId { get; set; } = null!;
    internal long AppRevision { get; set; }
    internal string PackageId { get; set; } = null!;
    internal long PackageGeneration { get; set; }
    internal string ComponentId { get; set; } = null!;
    internal string ArtifactRepository { get; set; } = null!;
    internal string ArtifactManifestDigest { get; set; } = null!;
    internal int CpuMillis { get; set; }
    internal long MemoryBytes { get; set; }
    internal long RunDurationSeconds { get; set; }
    internal int MaxAttempts { get; set; }
    internal int Phase { get; set; }
    internal int Reason { get; set; }
    internal int AttemptCount { get; set; }
    internal long Revision { get; set; }
    internal long CreatedAtUnixMs { get; set; }
    internal long? StartedAtUnixMs { get; set; }
    internal long UpdatedAtUnixMs { get; set; }
    internal long? CompletedAtUnixMs { get; set; }

    internal static Run Restore(RunRecord record)
    {
        var run = new Run();
        run.Apply(record);
        return run;
    }

    internal static Run RestoreStorage(
        string runId,
        string workloadId,
        long workloadRevision,
        string placementId,
        int targetKind,
        string? tenantId,
        string? workspaceId,
        string? accountPrincipalId,
        string? actorPrincipalId,
        string appId,
        long appRevision,
        string packageId,
        long packageGeneration,
        string componentId,
        string artifactRepository,
        string artifactManifestDigest,
        int cpuMillis,
        long memoryBytes,
        long runDurationSeconds,
        int maxAttempts,
        int phase,
        int reason,
        int attemptCount,
        long revision,
        long createdAtUnixMs,
        long? startedAtUnixMs,
        long updatedAtUnixMs,
        long? completedAtUnixMs) =>
        new()
        {
            RunId = runId,
            WorkloadId = workloadId,
            WorkloadRevision = workloadRevision,
            PlacementId = placementId,
            TargetKind = targetKind,
            TenantId = tenantId,
            WorkspaceId = workspaceId,
            AccountPrincipalId = accountPrincipalId,
            ActorPrincipalId = actorPrincipalId,
            AppId = appId,
            AppRevision = appRevision,
            PackageId = packageId,
            PackageGeneration = packageGeneration,
            ComponentId = componentId,
            ArtifactRepository = artifactRepository,
            ArtifactManifestDigest = artifactManifestDigest,
            CpuMillis = cpuMillis,
            MemoryBytes = memoryBytes,
            RunDurationSeconds = runDurationSeconds,
            MaxAttempts = maxAttempts,
            Phase = phase,
            Reason = reason,
            AttemptCount = attemptCount,
            Revision = revision,
            CreatedAtUnixMs = createdAtUnixMs,
            StartedAtUnixMs = startedAtUnixMs,
            UpdatedAtUnixMs = updatedAtUnixMs,
            CompletedAtUnixMs = completedAtUnixMs
        };

    internal void Apply(RunRecord record)
    {
        var targetKind = record.Target switch
        {
            PlacementTarget.Global => 1,
            PlacementTarget.Tenant => 2,
            PlacementTarget.Workspace => 3,
            PlacementTarget.User => 4,
            _ => throw new InvalidOperationException(
                "Run target is invalid")
        };
        RunId = record.Id.Value;
        WorkloadId = record.WorkloadId.Value;
        WorkloadRevision = record.WorkloadRevision.Value;
        PlacementId = record.PlacementId.Value;
        TargetKind = targetKind;
        TenantId = record.Target switch
            {
                PlacementTarget.Tenant tenant => tenant.TenantId.Value,
                PlacementTarget.Workspace workspace =>
                    workspace.TenantId.Value,
                PlacementTarget.User user => user.TenantId.Value,
                _ => null
            };
        WorkspaceId =
                record.Target is PlacementTarget.Workspace workspaceTarget
                    ? workspaceTarget.WorkspaceId.Value
                    : null;
        AccountPrincipalId =
                record.Target is PlacementTarget.User userTarget
                    ? userTarget.AccountPrincipalId.Value
                    : null;
        ActorPrincipalId = record.ActorPrincipalId?.Value;
        AppId = record.Execution.AdmittedPackage.AppId.Value;
        AppRevision =
            record.Execution.AdmittedPackage.AppRevision.Value;
        PackageId =
            record.Execution.AdmittedPackage.PackageId.Value;
        PackageGeneration = record.Execution.AdmittedPackage
            .PackageGeneration.Value;
        ComponentId =
            record.Execution.AdmittedPackage.ComponentId.Value;
        ArtifactRepository = record.Execution.AdmittedPackage
            .ArtifactRepository.Value;
        ArtifactManifestDigest = record.Execution.AdmittedPackage
            .ArtifactManifestDigest.Value;
        CpuMillis = record.Execution.Resources.CpuMillis;
        MemoryBytes = record.Execution.Resources.MemoryBytes;
        RunDurationSeconds = record.Execution.RunDurationSeconds;
        MaxAttempts = record.Execution.MaxAttempts;
        Phase = (int)record.Phase;
        Reason = (int)record.Reason;
        AttemptCount = record.AttemptCount;
        Revision = record.Revision.Value;
        CreatedAtUnixMs = record.CreatedAt.UnixMilliseconds;
        StartedAtUnixMs = record.StartedAt?.UnixMilliseconds;
        UpdatedAtUnixMs = record.UpdatedAt.UnixMilliseconds;
        CompletedAtUnixMs = record.CompletedAt?.UnixMilliseconds;
    }

    internal void RequestCancellation(UtcInstant now)
    {
        Phase = (int)RunPhase.Cancelling;
        Reason = (int)RunReason.CancelRequested;
        Revision = checked(Revision + 1);
        UpdatedAtUnixMs = now.UnixMilliseconds;
    }
}

public class RunConfigTarget
{
    internal string RunId { get; set; } = null!;
    internal int DataKind { get; set; }
    internal string Purpose { get; set; } = null!;
    internal string TargetId { get; set; } = null!;
    internal string TargetVersionId { get; set; } = null!;
    internal string? ProjectionId { get; set; }
    internal long? ProjectionRevision { get; set; }
}

public class RunDependency
{
    internal string RunId { get; set; } = null!;
    internal string ComponentId { get; set; } = null!;
    internal string DependencyName { get; set; } = null!;
    internal string? DependencyId { get; set; }
    internal string DependencyType { get; set; } = null!;
    internal byte[] OptionsJson { get; set; } = null!;
    internal int OptionsLength { get; set; }
    internal string OptionsSha256 { get; set; } = null!;
    internal string ProvisionerId { get; set; } = null!;
    internal string ProvisionerSubject { get; set; } = null!;
    internal string ClaimId { get; set; } = null!;
    internal long ClaimRevision { get; set; }
    internal string? BindingId { get; set; }
    internal long? BindingRevision { get; set; }
    internal long ObservedClaimRevision { get; set; }
    internal int BindingPhase { get; set; }
}

public class RunDependencyParameter
{
    internal string RunId { get; set; } = null!;
    internal string ComponentId { get; set; } = null!;
    internal string DependencyName { get; set; } = null!;
    internal string ParameterName { get; set; } = null!;
    internal int DataKind { get; set; }
    internal string Purpose { get; set; } = null!;
    internal string TargetId { get; set; } = null!;
    internal string TargetVersionId { get; set; } = null!;
    internal string ProjectionId { get; set; } = null!;
    internal long ProjectionRevision { get; set; }
}

public class RunDependencyOutput
{
    internal string RunId { get; set; } = null!;
    internal string ComponentId { get; set; } = null!;
    internal string DependencyName { get; set; } = null!;
    internal int DataKind { get; set; }
    internal string Purpose { get; set; } = null!;
    internal string TargetId { get; set; } = null!;
    internal string TargetVersionId { get; set; } = null!;
    internal string ProjectionId { get; set; } = null!;
    internal long ProjectionRevision { get; set; }
}

public class RunStorage
{
    internal string RunId { get; set; } = null!;
    internal string StorageId { get; set; } = null!;
    internal string MountPath { get; set; } = null!;
    internal long CapacityBytes { get; set; }
}
