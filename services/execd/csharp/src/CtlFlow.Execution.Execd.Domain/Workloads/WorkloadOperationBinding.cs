using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

// The resolved facts behind one admitted Workload operation: exactly what the
// caller-visible response carries. Workload and Placement identifiers,
// revisions, component IDs, and the package generation stay internal to the
// resolution.
public sealed record WorkloadOperationBinding(
    AppId AppId,
    PackageId PackageId,
    PlacementTarget EffectiveTarget);
