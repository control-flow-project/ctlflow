using CtlFlow.Execution.Execd.Domain.Resources;

namespace CtlFlow.Execution.Execd.Domain.Placements;

public static partial class Placements
{
    public static ValueTask<bool> IsPlacementEffectivelyActive(
        IReadOnlyList<PlacementRecord> lineage,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (lineage.Count == 0)
        {
            throw new InvalidOperationException(
                "Placement lineage is empty");
        }

        var visited = new HashSet<Identifiers.PlacementId>();
        for (var index = 0; index < lineage.Count; index++)
        {
            var current = lineage[index];
            if (!visited.Add(current.Id))
            {
                throw new InvalidOperationException(
                    "Placement lineage contains a cycle");
            }

            var expectedParent = index + 1 < lineage.Count
                ? lineage[index + 1].Id
                : null;
            if (current.ParentId != expectedParent)
            {
                throw new InvalidOperationException(
                    "Placement lineage is incomplete");
            }

            if (current.DesiredState != DesiredState.Active)
            {
                return ValueTask.FromResult(false);
            }
        }

        return ValueTask.FromResult(true);
    }
}
