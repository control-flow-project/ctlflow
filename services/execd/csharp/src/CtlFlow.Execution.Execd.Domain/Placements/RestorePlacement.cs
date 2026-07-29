namespace CtlFlow.Execution.Execd.Domain.Placements;

public static partial class Placements
{
    public static ValueTask<Placement> RestorePlacement(
        PlacementRecord record,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(Placement.Restore(record));
    }
}
