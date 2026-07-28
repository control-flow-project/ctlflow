using CtlFlow.Configuration.Configd.Domain.Auditing;
using CtlFlow.Configuration.Configd.Domain.Bindings;
using CtlFlow.Configuration.Configd.Domain.Identifiers;
using CtlFlow.Configuration.Configd.Domain.Revisions;

namespace CtlFlow.Configuration.Configd.Domain.Projections;

public static partial class Projections
{
    public static async ValueTask<ProjectionPlan> PlanProjection(
        ProjectionTarget target,
        ConsumerBinding binding,
        ProjectionId derivedId,
        Projection? existing,
        bool projectionIdCollides,
        bool targetExists,
        bool secretTargetIsCurrent,
        bool targetWasPreviouslySelected,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!targetExists)
        {
            return new ProjectionPlan.NotFound();
        }

        if (target is ProjectionTarget.Secret && !secretTargetIsCurrent)
        {
            return new ProjectionPlan.FailedPrecondition();
        }

        if (projectionIdCollides)
        {
            return new ProjectionPlan.AlreadyExists();
        }

        if (existing is null)
        {
            var revision = Revision.Initial();
            var creationEnvelope = AuditEnvelope.Create(audit);
            var entity = new Projection(
                derivedId,
                target,
                binding,
                revision,
                creationEnvelope.EventId,
                audit.OccurredAt,
                audit.OccurredAt);
            return await CreateChangedPlan(
                entity,
                target,
                ProjectionAuditAction.Created,
                creationEnvelope,
                cancellation);
        }

        if (existing.Id != derivedId || existing.Binding != binding)
        {
            return new ProjectionPlan.AlreadyExists();
        }

        if (!TargetsSameIdentity(existing.Target, target))
        {
            return new ProjectionPlan.FailedPrecondition();
        }

        if (existing.Target == target)
        {
            return new ProjectionPlan.Current(
                await DescribeProjection(existing, cancellation));
        }

        if (targetWasPreviouslySelected
            || existing.Revision.Value == long.MaxValue)
        {
            return new ProjectionPlan.FailedPrecondition();
        }

        var changeEnvelope = AuditEnvelope.Create(audit);
        existing.SelectTarget(
            target,
            changeEnvelope.EventId,
            audit.OccurredAt);
        return await CreateChangedPlan(
            existing,
            target,
            ProjectionAuditAction.VersionChanged,
            changeEnvelope,
            cancellation);
    }

    private static bool TargetsSameIdentity(
        ProjectionTarget left,
        ProjectionTarget right) =>
        (left, right) switch
        {
            (
                ProjectionTarget.Configuration leftConfiguration,
                ProjectionTarget.Configuration rightConfiguration) =>
                leftConfiguration.ConfigurationId
                    == rightConfiguration.ConfigurationId,
            (
                ProjectionTarget.Secret leftSecret,
                ProjectionTarget.Secret rightSecret) =>
                leftSecret.SecretId == rightSecret.SecretId,
            _ => false
        };

    private static async ValueTask<ProjectionPlan> CreateChangedPlan(
        Projection entity,
        ProjectionTarget target,
        ProjectionAuditAction action,
        AuditEnvelope envelope,
        CancellationToken cancellation)
    {
        var metadata = await DescribeProjection(entity, cancellation);
        var entry = new ProjectionTargetEntry(
            entity.Id,
            target,
            entity.Revision);
        var intent = new ProjectionAuditIntent(
            envelope,
            entity.Id,
            action,
            entity.Revision,
            target,
            entity.Binding);
        return new ProjectionPlan.Changed(entity, entry, metadata, intent);
    }

}
