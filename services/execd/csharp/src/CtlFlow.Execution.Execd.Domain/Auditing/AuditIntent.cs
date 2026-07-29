using CtlFlow.Execution.Execd.Domain.Identifiers;
using CtlFlow.Execution.Execd.Domain.Placements;
using CtlFlow.Execution.Execd.Domain.Resources;
using CtlFlow.Execution.Execd.Domain.Time;

namespace CtlFlow.Execution.Execd.Domain.Auditing;

public abstract record AuditIntent(
    AuditEventId EventId,
    AuditAttribution Attribution,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt)
{
    public sealed record PlacementMutation(
        AuditEventId EventId,
        AuditAttribution Attribution,
        AuditCorrelation Correlation,
        UtcInstant OccurredAt,
        PlacementId PlacementId,
        PlacementTarget Target,
        PlacementAuditAction Action,
        Revision Revision,
        DesiredState DesiredState)
        : AuditIntent(
            EventId,
            Attribution,
            Correlation,
            OccurredAt);

    public sealed record WorkloadMutation(
        AuditEventId EventId,
        AuditAttribution Attribution,
        AuditCorrelation Correlation,
        UtcInstant OccurredAt,
        WorkloadId WorkloadId,
        PlacementId PlacementId,
        PlacementTarget Target,
        WorkloadAuditAction Action,
        Revision Revision,
        DesiredState DesiredState,
        AppId AppId,
        Revision AppRevision,
        PackageId PackageId,
        Revision PackageGeneration,
        ComponentId ComponentId)
        : AuditIntent(
            EventId,
            Attribution,
            Correlation,
            OccurredAt);

    public sealed record RunMutation(
        AuditEventId EventId,
        AuditAttribution Attribution,
        AuditCorrelation Correlation,
        UtcInstant OccurredAt,
        RunId RunId,
        WorkloadId WorkloadId,
        PlacementId PlacementId,
        PlacementTarget Target,
        RunAuditAction Action,
        Revision Revision,
        PrincipalId? ActorPrincipalId)
        : AuditIntent(
            EventId,
            Attribution,
            Correlation,
            OccurredAt);
}
