namespace CtlFlow.Configuration.Configd.Domain.Projections;

public static partial class Projections
{
    public static ValueTask<ProjectionMetadata> DescribeProjection(
        Projection projection,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new ProjectionMetadata(
            projection.Id,
            projection.Target,
            projection.Binding,
            projection.Revision,
            projection.CreatedAt,
            projection.UpdatedAt));
    }
}
