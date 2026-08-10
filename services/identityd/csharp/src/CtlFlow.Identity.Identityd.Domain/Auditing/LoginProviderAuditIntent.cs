using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public enum LoginProviderAuditAction
{
    Created,
    Updated,
    StateChanged
}

public sealed record LoginProviderAuditIntent(
    AuditEventId EventId,
    AuditAttribution Attribution,
    TenantId TenantId,
    ProviderId ProviderId,
    Revision ProviderRevision,
    LoginProviderState ResultingState,
    LoginProviderAuditAction Action,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt)
    : IdentityAdministrationAuditIntent(
        EventId,
        Attribution,
        TenantId,
        Correlation,
        OccurredAt);
