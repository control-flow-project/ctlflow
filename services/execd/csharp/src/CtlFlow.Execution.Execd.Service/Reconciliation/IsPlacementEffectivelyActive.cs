using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Placements;

namespace CtlFlow.Execution.Execd.Service.Reconciliation;

internal static partial class ExecutionReconciliation
{
    internal static async Task<bool> IsPlacementEffectivelyActive(
        ExecutionDatabase database,
        PlacementRecord placement,
        CancellationToken cancellation)
    {
        var lineage =
            await Db.Placements.Placements.LoadPlacementLineage(
                database,
                placement,
                cancellation);
        return await Domain.Placements.Placements
            .IsPlacementEffectivelyActive(
                lineage,
                cancellation);
    }
}
