using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public sealed record RequestedProvisioningParameter(
    ParameterName Name,
    ConfigTargetReference Target);

public sealed record RequestedDependencySelection(
    ComponentId ComponentId,
    DependencyName Name,
    DependencyId? DependencyId,
    IReadOnlyList<RequestedProvisioningParameter> Parameters);

public sealed record WorkloadRequest(
    WorkloadId Id,
    PlacementId PlacementId,
    DesiredState DesiredState,
    PackageComponentReference PackageComponent,
    ExecutionResources Resources,
    IReadOnlyList<ConfigTargetReference> ConfigTargets,
    IReadOnlyList<RequestedDependencySelection> Dependencies,
    IReadOnlyList<PersistentStorage> Storage,
    WorkloadBehavior Behavior,
    Revision? ExpectedRevision);
