namespace CtlFlow.Configuration.Configd.Domain.Projections;

using CtlFlow.Configuration.Configd.Domain.Auditing;

public static partial class Projections
{
    public static ValueTask<Projection> RestoreProjection(
        ProjectionMetadata metadata,
        AuditEventId auditEventId,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (metadata.UpdatedAt.Value < metadata.CreatedAt.Value)
        {
            throw new InvalidOperationException(
                "Stored projection timestamps are inconsistent");
        }

        return ValueTask.FromResult(new Projection(
            metadata.Id,
            metadata.Target,
            metadata.Binding,
            metadata.Revision,
            auditEventId,
            metadata.CreatedAt,
            metadata.UpdatedAt));
    }
}
