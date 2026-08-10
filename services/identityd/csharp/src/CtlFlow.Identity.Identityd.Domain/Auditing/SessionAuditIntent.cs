using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Sessions;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public sealed record SessionAuditIntent(
    AuditEventId EventId,
    SessionAuditAction Action,
    AuditAttribution Attribution,
    SessionId SessionId,
    AccountId AccountId,
    TenantId TenantId,
    Revision SessionRevision,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt)
    : IdentityAuditIntent(
        EventId,
        Attribution,
        TenantId,
        Correlation,
        OccurredAt);
