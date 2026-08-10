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

    public VirtualPrincipal(
        VirtualPrincipalId id,
        AccountId subjectAccountId,
        TenantId tenantFenceId,
        WorkspaceId? workspaceFenceId,
        bool enabled,
        Revision revision)
    {
        _id = id.Value;
        _subjectAccountId = subjectAccountId.Value;
        _tenantFenceId = tenantFenceId.Value;
        _workspaceFenceId = workspaceFenceId?.Value;
        Enabled = enabled;
        Revision = revision;
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

    internal void SetEnabled(bool enabled)
    {
        Enabled = enabled;
        Revision = Revision.Next();
    }
}
