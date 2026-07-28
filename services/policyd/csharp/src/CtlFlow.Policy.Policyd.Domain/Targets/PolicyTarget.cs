using CtlFlow.Policy.Policyd.Domain.Identifiers;

namespace CtlFlow.Policy.Policyd.Domain.Targets;

public readonly record struct PolicyTarget(
    TenantId TenantId,
    WorkspaceId? WorkspaceId)
{
    public TargetKind Kind =>
        WorkspaceId is null ? TargetKind.Tenant : TargetKind.Workspace;
}
