using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public enum VirtualPrincipalAuditAction
{
    Created,
    EnabledStateChanged
}

public sealed record VirtualPrincipalAuditIntent(
    AuditEventId EventId,
    AuditAttribution Attribution,
    TenantId TenantId,
    WorkspaceId? WorkspaceId,
    VirtualPrincipalId PrincipalId,
    AccountId AttachedAccountId,
    Revision PrincipalRevision,
    bool Enabled,
    VirtualPrincipalAuditAction Action,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt)
    : IdentityAdministrationAuditIntent(
        EventId,
        Attribution,
        TenantId,
        Correlation,
        OccurredAt);
