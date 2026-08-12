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

    public WorkspaceMembership(
        AccountId accountId,
        TenantId tenantId,
        WorkspaceId workspaceId,
        Revision revision)
    {
        _accountId = accountId.Value;
        _tenantId = tenantId.Value;
        _workspaceId = workspaceId.Value;
        Revision = revision;
    }

    public AccountId AccountId => AccountId.FromStorage(_accountId);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public WorkspaceId WorkspaceId =>
        WorkspaceId.FromStorage(_workspaceId);

    public Revision Revision { get; private set; } = null!;
}
