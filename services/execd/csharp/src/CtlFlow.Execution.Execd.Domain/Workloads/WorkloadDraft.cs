using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Operations;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public sealed record WorkloadDraft(
    WorkloadId Id,
    PlacementId PlacementId,
    DesiredState DesiredState,
    PackageComponentReference PackageComponent,
    ExecutionResources Resources,
    IReadOnlyList<ResolvedConfigTarget> ConfigTargets,
    IReadOnlyList<AdmittedDependency> Dependencies,
    IReadOnlyList<PersistentStorage> Storage,
    WorkloadBehavior Behavior,
    AdmittedPackageComponent AdmittedPackage,
    IReadOnlyList<AdmittedInterface> Interfaces,
    // Operations admitted for this Workload, snapshotted from the selected
    // component at admission. Authority reflects what was admitted.
    IReadOnlyList<OperationToken> AdmittedOperations);
