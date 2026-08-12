using CtlFlow.Identity.Identityd.Domain.Providers;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Time;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Auditing;

public enum WorkspaceProviderAdmissionAuditAction
{
    Admitted,
    Removed
}

public sealed record WorkspaceProviderAdmissionAuditIntent(
    AuditEventId EventId,
    AuditAttribution Attribution,
    TenantId TenantId,
    WorkspaceId WorkspaceId,
    ProviderId ProviderId,
    WorkspaceProviderAdmissionAuditAction Action,
    AuditCorrelation Correlation,
    UtcInstant OccurredAt)
    : IdentityAdministrationAuditIntent(
        EventId,
        Attribution,
        TenantId,
        Correlation,
        OccurredAt);
