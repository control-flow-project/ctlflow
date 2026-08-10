using CtlFlow.Identity.Identityd.Domain.IdentityLinks;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Providers;

public class WorkspaceLoginProviderAdmission
{
    private string _tenantId = null!;
    private string _workspaceId = null!;
    private string _providerId = null!;

    private WorkspaceLoginProviderAdmission()
    {
    }

    public WorkspaceLoginProviderAdmission(
        TenantId tenantId,
        WorkspaceId workspaceId,
        ProviderId providerId)
    {
        _tenantId = tenantId.Value;
        _workspaceId = workspaceId.Value;
        _providerId = providerId.Value;
    }

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public WorkspaceId WorkspaceId => WorkspaceId.FromStorage(_workspaceId);

    public ProviderId ProviderId => ProviderId.FromStorage(_providerId);
}
