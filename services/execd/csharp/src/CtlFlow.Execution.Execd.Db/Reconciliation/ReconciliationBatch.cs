using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Runs;
using CtlFlow.Execution.Execd.Domain.Workloads;

namespace CtlFlow.Execution.Execd.Db.Reconciliation;

public sealed record ReconciliationBatch(
    IReadOnlyList<PlacementRecord> Placements,
    IReadOnlyList<WorkloadRecord> Workloads,
    IReadOnlyList<RunRecord> Runs);
