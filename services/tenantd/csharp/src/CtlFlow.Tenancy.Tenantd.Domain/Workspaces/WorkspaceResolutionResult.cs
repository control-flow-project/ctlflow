using CtlFlow.Tenancy.Tenantd.Domain.Resources;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public abstract record WorkspaceResolutionResult
{
    private WorkspaceResolutionResult()
    {
    }

    public sealed record Found(
        WorkspaceId WorkspaceId,
        ResourceState State,
        Revision Revision) : WorkspaceResolutionResult;

    public sealed record NotFound : WorkspaceResolutionResult;
}
