using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;

namespace CtlFlow.Execution.Execd.Db.Placements;

public static partial class Placements
{
    public static async Task<IReadOnlyList<PlacementRecord>>
        LoadPlacementLineage(
            ExecutionDatabase database,
            PlacementRecord placement,
            CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "load_placement_lineage");
        var lineage = new List<PlacementRecord>();
        var visited = new HashSet<PlacementId>();
        var current = placement;
        while (true)
        {
            if (!visited.Add(current.Id))
            {
                throw new InvalidOperationException(
                    "Placement parent cycle was retained");
            }

            lineage.Add(current);
            if (current.ParentId is null)
            {
                return lineage;
            }

            current = await LoadPlacement(
                database,
                current.ParentId,
                cancellation)
                ?? throw new InvalidOperationException(
                    "Placement parent was not retained");
        }
    }
}
