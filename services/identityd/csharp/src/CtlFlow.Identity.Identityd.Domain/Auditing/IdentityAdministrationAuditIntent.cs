using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public abstract record IdentityAdministrationAuditIntent(
    AuditEventId EventId,
    AuditAttribution Attribution,
    TenantId TenantId,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt)
    : IdentityAuditIntent(
        EventId,
        Attribution,
        TenantId,
        Correlation,
        OccurredAt);
