using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public class Workload
{
    private Workload()
    {
    }

    internal string WorkloadId { get; set; } = null!;
    internal string PlacementId { get; set; } = null!;
    internal int DesiredState { get; set; }
    internal int Mode { get; set; }
    internal string AppId { get; set; } = null!;
    internal long AppRevision { get; set; }
    internal string PackageId { get; set; } = null!;
    internal long PackageGeneration { get; set; }
    internal string ComponentId { get; set; } = null!;
    // Derived by Execd in the admission transaction; never caller-supplied.
    internal string ServiceAccountSubject { get; set; } = null!;
    internal string ArtifactRepository { get; set; } = null!;
    internal string ArtifactManifestDigest { get; set; } = null!;
    internal int CpuMillis { get; set; }
    internal long MemoryBytes { get; set; }
    internal int? Replicas { get; set; }
    internal string? ActorPrincipalId { get; set; }
    internal long? RunDurationSeconds { get; set; }
    internal int? MaxAttempts { get; set; }
    internal long Revision { get; set; }
    internal long StatusRevision { get; set; }
    internal long ObservedRevision { get; set; }
    internal int RealizationPhase { get; set; }
    internal int RealizationReason { get; set; }
    internal long CreatedAtUnixMs { get; set; }
    internal long UpdatedAtUnixMs { get; set; }
    internal long StatusUpdatedAtUnixMs { get; set; }

    internal static Workload Restore(WorkloadRecord record)
    {
        var entity = new Workload();
        entity.Apply(record);
        return entity;
    }

    internal static Workload RestoreStorage(
        string workloadId,
        string placementId,
        int desiredState,
        int mode,
        string appId,
        long appRevision,
        string packageId,
        long packageGeneration,
        string componentId,
        string serviceAccountSubject,
        string artifactRepository,
        string artifactManifestDigest,
        int cpuMillis,
        long memoryBytes,
        int? replicas,
        string? actorPrincipalId,
        long? runDurationSeconds,
        int? maxAttempts,
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
            WorkloadId = workloadId,
            ServiceAccountSubject = serviceAccountSubject,
            PlacementId = placementId,
            DesiredState = desiredState,
            Mode = mode,
            AppId = appId,
            AppRevision = appRevision,
            PackageId = packageId,
            PackageGeneration = packageGeneration,
            ComponentId = componentId,
            ArtifactRepository = artifactRepository,
            ArtifactManifestDigest = artifactManifestDigest,
            CpuMillis = cpuMillis,
            MemoryBytes = memoryBytes,
            Replicas = replicas,
            ActorPrincipalId = actorPrincipalId,
            RunDurationSeconds = runDurationSeconds,
            MaxAttempts = maxAttempts,
            Revision = revision,
            StatusRevision = statusRevision,
            ObservedRevision = observedRevision,
            RealizationPhase = realizationPhase,
            RealizationReason = realizationReason,
            CreatedAtUnixMs = createdAtUnixMs,
            UpdatedAtUnixMs = updatedAtUnixMs,
            StatusUpdatedAtUnixMs = statusUpdatedAtUnixMs
        };

    internal void Apply(WorkloadRecord record)
    {
        WorkloadId = record.Id.Value;
        PlacementId = record.PlacementId.Value;
        // The admission decision derived the subject; persistence retains it
        // so realization consumes a retained identity rather than creating one.
        ServiceAccountSubject = record.ServiceAccountSubject;
        DesiredState = (int)record.DesiredState;
        AppId = record.AdmittedPackage.AppId.Value;
        AppRevision = record.AdmittedPackage.AppRevision.Value;
        PackageId = record.AdmittedPackage.PackageId.Value;
        PackageGeneration =
            record.AdmittedPackage.PackageGeneration.Value;
        ComponentId = record.AdmittedPackage.ComponentId.Value;
        ArtifactRepository =
            record.AdmittedPackage.ArtifactRepository.Value;
        ArtifactManifestDigest =
            record.AdmittedPackage.ArtifactManifestDigest.Value;
        CpuMillis = record.Resources.CpuMillis;
        MemoryBytes = record.Resources.MemoryBytes;
        Replicas = null;
        ActorPrincipalId = null;
        RunDurationSeconds = null;
        MaxAttempts = null;
        switch (record.Behavior)
        {
            case WorkloadBehavior.Continuous continuous:
                Mode = (int)WorkloadMode.Continuous;
                Replicas = continuous.Replicas;
                break;
            case WorkloadBehavior.Finite finite:
                Mode = (int)WorkloadMode.Finite;
                ActorPrincipalId = finite.ActorPrincipalId?.Value;
                RunDurationSeconds = finite.RunDurationSeconds;
                MaxAttempts = finite.MaxAttempts;
                break;
            default:
                throw new InvalidOperationException(
                    "Workload behavior is invalid");
        }

        Revision = record.Revision.Value;
        StatusRevision = record.Realization.StatusRevision.Value;
        ObservedRevision = record.Realization.ObservedRevision;
        RealizationPhase = (int)record.Realization.Phase;
        RealizationReason = (int)record.Realization.Reason;
        CreatedAtUnixMs = record.CreatedAt.UnixMilliseconds;
        UpdatedAtUnixMs = record.UpdatedAt.UnixMilliseconds;
        StatusUpdatedAtUnixMs =
            record.Realization.UpdatedAt.UnixMilliseconds;
    }
}

public class WorkloadConfigTarget
{
    internal string WorkloadId { get; set; } = null!;
    internal int DataKind { get; set; }
    internal string Purpose { get; set; } = null!;
    internal string TargetId { get; set; } = null!;
    internal string TargetVersionId { get; set; } = null!;
    internal string? ProjectionId { get; set; }
    internal long? ProjectionRevision { get; set; }
}

public class WorkloadDependency
{
    internal string WorkloadId { get; set; } = null!;
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

public class WorkloadDependencyParameter
{
    internal string WorkloadId { get; set; } = null!;
    internal string ComponentId { get; set; } = null!;
    internal string DependencyName { get; set; } = null!;
    internal string ParameterName { get; set; } = null!;
    internal int DataKind { get; set; }
    internal string Purpose { get; set; } = null!;
    internal string TargetId { get; set; } = null!;
    internal string TargetVersionId { get; set; } = null!;
    internal string? ProjectionId { get; set; }
    internal long? ProjectionRevision { get; set; }
}

public class WorkloadDependencyOutput
{
    internal string WorkloadId { get; set; } = null!;
    internal string ComponentId { get; set; } = null!;
    internal string DependencyName { get; set; } = null!;
    internal int DataKind { get; set; }
    internal string Purpose { get; set; } = null!;
    internal string TargetId { get; set; } = null!;
    internal string TargetVersionId { get; set; } = null!;
    internal string? ProjectionId { get; set; }
    internal long? ProjectionRevision { get; set; }
}

public class WorkloadStorage
{
    internal string WorkloadId { get; set; } = null!;
    internal string StorageId { get; set; } = null!;
    internal string MountPath { get; set; } = null!;
    internal long CapacityBytes { get; set; }
}

public class WorkloadInterface
{
    internal string WorkloadId { get; set; } = null!;
    internal string InterfaceId { get; set; } = null!;
    internal int Protocol { get; set; }
    internal string ContractId { get; set; } = null!;
    internal int Port { get; set; }
    internal string? ExposureId { get; set; }
    internal string? EndpointHost { get; set; }
    internal bool Ready { get; set; }
}
