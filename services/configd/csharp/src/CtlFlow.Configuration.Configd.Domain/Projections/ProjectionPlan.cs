using CtlFlow.Configuration.Configd.Domain.Auditing;

namespace CtlFlow.Configuration.Configd.Domain.Projections;

public abstract record ProjectionPlan
{
    private ProjectionPlan()
    {
    }

    public sealed record Current(
        ProjectionMetadata Projection) : ProjectionPlan;

    public sealed record Changed(
        Projection Entity,
        ProjectionTargetEntry TargetEntry,
        ProjectionMetadata Projection,
        ProjectionAuditIntent Audit) : ProjectionPlan;

    public sealed record NotFound : ProjectionPlan;

    public sealed record AlreadyExists : ProjectionPlan;

    public sealed record FailedPrecondition : ProjectionPlan;
}
