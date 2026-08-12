using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public enum MembershipAuditAction
{
    Added,
    Removed
}

public sealed record MembershipAuditIntent(
    AuditEventId EventId,
    AuditAttribution Attribution,
    TenantId TenantId,
    WorkspaceId? WorkspaceId,
    AccountId AccountId,
    Revision MembershipRevision,
    MembershipAuditAction Action,
    bool AccountCreated,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt)
    : IdentityAdministrationAuditIntent(
        EventId,
        Attribution,
        TenantId,
        Correlation,
        OccurredAt);
