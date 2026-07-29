using CtlFlow.Execution.Execd.Db.Providers;
using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Db.Reconciliation;

public static partial class ReconciliationState
{
    public static async Task UpdatePlacementRealization(
        ExecutionDatabase database,
        PlacementId placementId,
        Revision desiredRevision,
        RealizationPhase phase,
        RealizationReason reason,
        UtcInstant now,
        CancellationToken cancellation)
    {
        using var activity = ExecutionDbTelemetry.StartOperation(
            "update_placement_realization");
        await using var lease =
            await database.AcquireMutation(cancellation);
        var current = await Db.Placements.Placements.LoadPlacement(
            database,
            placementId,
            cancellation);
        if (current is null)
        {
            return;
        }

        await using var context =
            await database.Contexts.CreateDbContextAsync(cancellation);
        var entity = Placement.Restore(current);
        context.Attach(entity);
        if (!await Domain.Placements.Placements
                .UpdatePlacementRealization(
                    entity,
                    current,
                    desiredRevision,
                    phase,
                    reason,
                    now,
                    cancellation))
        {
            return;
        }

        await context.SaveChangesAsync(cancellation);
    }
}
