using CtlFlow.Tenancy.Tenantd.Domain.Resources;

namespace CtlFlow.Tenancy.Tenantd.Domain.Auditing;

public sealed record AuditIntent(
    AuditEventId EventId,
    AuditOperation Operation,
    AuditAttribution Attribution,
    AuditTarget Target,
    ResourceState ResultingState,
    Revision ResultingRevision,
    AuditCorrelation Correlation,
    Time.UtcInstant OccurredAt);
