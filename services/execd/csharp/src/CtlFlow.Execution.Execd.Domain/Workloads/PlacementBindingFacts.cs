using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Workloads;

// One Placement in the Workload's ancestry, nearest first. HasParent makes a
// truncated chain distinguishable from a complete root.
public sealed record PlacementBindingFacts(
    PlacementTarget Target,
    DesiredState DesiredState,
    bool HasParent);
