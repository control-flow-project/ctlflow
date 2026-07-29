using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public sealed record ExecutionResources(int CpuMillis, long MemoryBytes)
{
    public static ExecutionResources Create(uint cpuMillis, ulong memoryBytes)
    {
        if (cpuMillis is 0 or > ExecutionLimits.MaximumCpuMillis
            || memoryBytes is 0 or > ExecutionLimits.MaximumMemoryBytes)
        {
            throw new ArgumentException("Execution resources are invalid");
        }

        return new ExecutionResources((int)cpuMillis, (long)memoryBytes);
    }
}

public sealed record PackageComponentReference(
    AppId AppId,
    ComponentId ComponentId);

public sealed record AdmittedPackageComponent(
    AppId AppId,
    Revision AppRevision,
    PackageId PackageId,
    Revision PackageGeneration,
    ComponentId ComponentId,
    ArtifactRepository ArtifactRepository,
    ManifestDigest ArtifactManifestDigest);

public sealed record PersistentStorage(
    StorageId StorageId,
    MountPath MountPath,
    long CapacityBytes);

public sealed record ProvisioningParameter(
    ParameterName Name,
    ResolvedConfigTarget Target);

public sealed record DependencySelection(
    ComponentId ComponentId,
    DependencyName Name,
    DependencyId? DependencyId,
    IReadOnlyList<ProvisioningParameter> Parameters);

public sealed record AdmittedDependency(
    DependencySelection Selection,
    DependencyType Type,
    int OptionsLength,
    string OptionsSha256,
    ProvisionerId ProvisionerId,
    ProvisionerSubject ProvisionerSubject,
    string ClaimId,
    Revision ClaimRevision,
    long ObservedClaimRevision,
    DependencyBindingPhase BindingPhase,
    BindingId? BindingId,
    Revision? BindingRevision,
    IReadOnlyList<ResolvedConfigTarget> Outputs);

public sealed record AdmittedInterface(
    InterfaceId InterfaceId,
    InterfaceProtocol Protocol,
    ContractId ContractId,
    int Port,
    ExposureId? ExposureId,
    EndpointHost? Host,
    bool Ready);

public abstract record WorkloadBehavior
{
    private WorkloadBehavior()
    {
    }

    public sealed record Continuous(
        int Replicas,
        IReadOnlyList<InterfaceId> InterfaceIds) : WorkloadBehavior;

    public sealed record Finite(
        PrincipalId? ActorPrincipalId,
        long RunDurationSeconds,
        int MaxAttempts) : WorkloadBehavior;
}
