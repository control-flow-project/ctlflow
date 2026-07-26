namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public abstract record WorkspaceListResult
{
    private WorkspaceListResult()
    {
    }

    public sealed record Found(WorkspacePage Page) : WorkspaceListResult;

    public sealed record TenantNotFound : WorkspaceListResult;
}
