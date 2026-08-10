using CtlFlow.Identity.Identityd.Domain.Tenants;
using CtlFlow.Identity.Identityd.Domain.Workspaces;

namespace CtlFlow.Identity.Identityd.Domain.Groups;

public class Group
{
    private string _id = null!;
    private string _tenantId = null!;
    private string? _workspaceId = null;

    private Group()
    {
    }

    public Group(
        GroupId id,
        TenantId tenantId,
        WorkspaceId? workspaceId)
    {
        _id = id.Value;
        _tenantId = tenantId.Value;
        _workspaceId = workspaceId?.Value;
    }

    public GroupId Id => GroupId.FromStorage(_id);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public WorkspaceId? WorkspaceId =>
        _workspaceId is null
            ? null
            : WorkspaceId.FromStorage(_workspaceId);
}
