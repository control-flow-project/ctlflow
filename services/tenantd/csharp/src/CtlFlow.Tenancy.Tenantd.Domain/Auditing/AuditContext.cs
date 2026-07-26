using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditContext(
    AuditAttribution Attribution,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt);
