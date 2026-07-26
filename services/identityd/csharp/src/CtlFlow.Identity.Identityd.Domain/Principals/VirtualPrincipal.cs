using CtlFlow.Identity.Identityd.Domain.Accounts;
using CtlFlow.Identity.Identityd.Domain.Resources;
using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Principals;

public class VirtualPrincipal
{
    private string _id = null!;
    private string _subjectAccountId = null!;
    private string _tenantFenceId = null!;
    private string? _workspaceFenceId = null;

    private VirtualPrincipal()
    {
    }

    public VirtualPrincipalId Id => VirtualPrincipalId.FromStorage(_id);

    public AccountId SubjectAccountId =>
        AccountId.FromStorage(_subjectAccountId);

    public bool Enabled { get; private set; }

    public Revision Revision { get; private set; } = null!;

    public TenantId TenantFenceId =>
        TenantId.FromStorage(_tenantFenceId);

    public WorkspaceId? WorkspaceFenceId =>
        _workspaceFenceId is null
            ? null
            : WorkspaceId.FromStorage(_workspaceFenceId);
}
