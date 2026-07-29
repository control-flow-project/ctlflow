using CtlFlow.Edge.Edged.Domain.Identifiers;

namespace CtlFlow.Edge.Edged.Domain.Bindings;

public abstract record ExposureTarget
{
    private ExposureTarget()
    {
    }

    public sealed record Tenant(TenantId TenantId) : ExposureTarget;

    public sealed record Workspace(
        TenantId TenantId,
        WorkspaceId WorkspaceId) : ExposureTarget;
}
