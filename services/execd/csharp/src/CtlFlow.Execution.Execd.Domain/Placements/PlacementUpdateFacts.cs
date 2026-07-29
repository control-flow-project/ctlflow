using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Domain.Placements;

public sealed record PlacementUpdateFacts(
    IReadOnlyList<PlacementRecord> ActiveChildren,
    IReadOnlyList<WorkloadRecord> ActiveWorkloads,
    bool HasNonterminalRun);
