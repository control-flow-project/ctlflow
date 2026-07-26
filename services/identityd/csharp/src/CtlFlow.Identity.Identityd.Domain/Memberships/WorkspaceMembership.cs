using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Memberships;

public class WorkspaceMembership
{
    private string _accountId = null!;
    private string _tenantId = null!;
    private string _workspaceId = null!;

    private WorkspaceMembership()
    {
    }

    public AccountId AccountId => AccountId.FromStorage(_accountId);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public WorkspaceId WorkspaceId =>
        WorkspaceId.FromStorage(_workspaceId);

    public Revision Revision { get; private set; } = null!;
}
