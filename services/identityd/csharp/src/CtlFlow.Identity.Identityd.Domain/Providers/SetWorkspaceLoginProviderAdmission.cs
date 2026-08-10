using CtlFlow.Identity.Identityd.Domain.Auditing;
using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Mutations;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public static partial class LoginProviders
{
    public static ValueTask<
        IdentityMutation<WorkspaceLoginProviderAdmission?>>
        SetWorkspaceLoginProviderAdmission(
            LoginProvider? provider,
            WorkspaceLoginProviderAdmission? existing,
            TenantId tenantId,
            WorkspaceId workspaceId,
            ProviderId providerId,
            bool admitted,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (admitted)
        {
            if (provider is null
                || provider.TenantId != tenantId
                || provider.ProviderId != providerId
                || provider.State == LoginProviderState.Deleted)
            {
                throw new IdentityPreconditionException();
            }

            if (existing is not null)
            {
                return ValueTask.FromResult(
                    new IdentityMutation<
                        WorkspaceLoginProviderAdmission?>(existing, null));
            }

            var admission = new WorkspaceLoginProviderAdmission(
                tenantId,
                workspaceId,
                providerId);
            return ValueTask.FromResult(
                new IdentityMutation<WorkspaceLoginProviderAdmission?>(
                    admission,
                    CreateAdmissionAudit(
                        tenantId,
                        workspaceId,
                        providerId,
                        WorkspaceProviderAdmissionAuditAction.Admitted,
                        audit)));
        }

        return ValueTask.FromResult(
            new IdentityMutation<WorkspaceLoginProviderAdmission?>(
                null,
                existing is null
                    ? null
                    : CreateAdmissionAudit(
                        tenantId,
                        workspaceId,
                        providerId,
                        WorkspaceProviderAdmissionAuditAction.Removed,
                        audit)));
    }

    private static WorkspaceProviderAdmissionAuditIntent
        CreateAdmissionAudit(
            TenantId tenantId,
            WorkspaceId workspaceId,
            ProviderId providerId,
            WorkspaceProviderAdmissionAuditAction action,
            AuditContext audit) => new(
            AuditEventId.Generate(),
            audit.Attribution,
            tenantId,
            workspaceId,
            providerId,
            action,
            audit.Correlation,
            audit.OccurredAt);
}
