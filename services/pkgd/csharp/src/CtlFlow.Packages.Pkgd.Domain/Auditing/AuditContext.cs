using CtlFlow.Packages.Pkgd.Domain.Time;

namespace CtlFlow.Packages.Pkgd.Domain.Auditing;

public sealed record AuditContext(
    AuditAttribution Attribution,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt);
