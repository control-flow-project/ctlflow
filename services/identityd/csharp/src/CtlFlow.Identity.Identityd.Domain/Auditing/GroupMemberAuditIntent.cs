using CtlFlow.Identity.Identityd.Domain.Groups;
using CtlFlow.Identity.Identityd.Domain.Principals;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public enum GroupMemberAuditAction
{
    Added,
    Removed
}

public sealed record GroupMemberAuditIntent(
    AuditEventId EventId,
    AuditAttribution Attribution,
    TenantId TenantId,
    WorkspaceId? WorkspaceId,
    GroupId GroupId,
    PrincipalId PrincipalId,
    GroupMemberAuditAction Action,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt)
    : IdentityAdministrationAuditIntent(
        EventId,
        Attribution,
        TenantId,
        Correlation,
        OccurredAt);
