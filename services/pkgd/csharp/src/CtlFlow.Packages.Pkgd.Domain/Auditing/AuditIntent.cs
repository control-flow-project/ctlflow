using CtlFlow.Packages.Pkgd.Domain.Apps;
using CtlFlow.Packages.Pkgd.Domain.Packages;
using CtlFlow.Packages.Pkgd.Domain.Time;

namespace CtlFlow.Packages.Pkgd.Domain.Auditing;

public abstract record AuditIntent(
    AuditEventId EventId,
    AuditAttribution Attribution,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt)
{
    public sealed record PackageDeclaration(
        AuditEventId EventId,
        AuditAttribution Attribution,
        AuditCorrelation Correlation,
        UtcInstant OccurredAt,
        PackageId PackageId,
        Generation Generation)
        : AuditIntent(EventId, Attribution, Correlation, OccurredAt);

    public sealed record AppMutation(
        AuditEventId EventId,
        AuditAttribution Attribution,
        AuditCorrelation Correlation,
        UtcInstant OccurredAt,
        AppId AppId,
        AppScope Scope,
        PlacementId PlacementId,
        PackageId PackageId,
        Generation PackageGeneration,
        Revision AppRevision,
        AppAuditAction Action)
        : AuditIntent(EventId, Attribution, Correlation, OccurredAt);
}
