using CtlFlow.Execution.Execd.Domain.Configuration;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

public sealed record WorkloadRecord(
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
    Revision Revision,
    RealizationStatus Realization,
    UtcInstant CreatedAt,
    UtcInstant UpdatedAt);
