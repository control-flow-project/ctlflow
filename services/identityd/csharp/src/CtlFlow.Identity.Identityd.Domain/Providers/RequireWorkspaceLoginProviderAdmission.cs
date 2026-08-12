using CtlFlow.Identity.Identityd.Domain.Errors;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public static partial class LoginProviders
{
    public static ValueTask<WorkspaceLoginProviderAdmission>
        RequireWorkspaceLoginProviderAdmission(
            WorkspaceLoginProviderAdmission? admission,
            TenantId tenantId,
            WorkspaceId workspaceId,
            ProviderId providerId,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (admission is null
            || admission.TenantId != tenantId
            || admission.WorkspaceId != workspaceId
            || admission.ProviderId != providerId)
        {
            throw new IdentityNotFoundException();
        }

        return ValueTask.FromResult(admission);
    }
}
