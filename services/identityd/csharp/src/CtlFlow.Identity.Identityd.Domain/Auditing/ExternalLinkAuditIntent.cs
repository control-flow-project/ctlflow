using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public enum ExternalLinkAuditAction
{
    Created,
    Deleted
}

public sealed record ExternalLinkAuditIntent(
    AuditEventId EventId,
    AuditAttribution Attribution,
    TenantId TenantId,
    ExternalLinkId ExternalLinkId,
    ProviderId ProviderId,
    AccountId AccountId,
    ExternalLinkAuditAction Action,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt)
    : IdentityAdministrationAuditIntent(
        EventId,
        Attribution,
        TenantId,
        Correlation,
        OccurredAt);
