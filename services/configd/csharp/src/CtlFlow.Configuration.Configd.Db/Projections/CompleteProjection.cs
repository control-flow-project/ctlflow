using CtlFlow.Configuration.Configd.Domain.Projections;
using Microsoft.EntityFrameworkCore;

namespace CtlFlow.Configuration.Configd.Db.Projections;

public static partial class Projections
{
    public static async Task<ProjectionCompletion> CompleteProjection(
        ProjectionApplicationLease application,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        using var activity = ConfigurationDbTelemetry.StartOperation(
            "complete_projection");
        return application.Plan switch
        {
            ProjectionPlan.Current current => new ProjectionCompletion(
                current.Projection,
                null),
            ProjectionPlan.Changed changed =>
                await SaveChangedProjection(
                    application,
                    changed,
                    cancellation),
            _ => throw new InvalidOperationException(
                "Projection application plan is not ready")
        };
    }

    private static async Task<ProjectionCompletion> SaveChangedProjection(
        ProjectionApplicationLease application,
        ProjectionPlan.Changed changed,
        CancellationToken cancellation)
    {
        try
        {
            await application.Database.SaveChangesAsync(cancellation);
            return new ProjectionCompletion(
                changed.Projection,
                changed.Audit);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new InvalidOperationException(
                "Projection changed concurrently",
                exception);
        }
    }
}
