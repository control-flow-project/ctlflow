using CtlFlow.Policy.Policyd.Domain.Identifiers;
using CtlFlow.Policy.Policyd.Domain.Targets;

namespace CtlFlow.Policy.Policyd.Domain.Roles;

public class Role
{
    private string _id = null!;
    private int _targetKind;
    private string _tenantId = null!;
    private string? _workspaceId;

    private Role()
    {
    }

    public Role(
        RoleId id,
        TenantId tenantId,
        WorkspaceId? workspaceId)
    {
        _id = id.Value;
        _tenantId = tenantId.Value;
        _workspaceId = workspaceId?.Value;
        _targetKind = TargetKindCodes.ToStorage(
            workspaceId is null
                ? TargetKind.Tenant
                : TargetKind.Workspace);
    }

    public RoleId Id => RoleId.FromStorage(_id);

    public TargetKind TargetKind => TargetKindCodes.FromStorage(_targetKind);

    public TenantId TenantId => TenantId.FromStorage(_tenantId);

    public WorkspaceId? WorkspaceId =>
        _workspaceId is null
            ? null
            : CtlFlow.Policy.Policyd.Domain.Identifiers.WorkspaceId
                .FromStorage(_workspaceId);
}
