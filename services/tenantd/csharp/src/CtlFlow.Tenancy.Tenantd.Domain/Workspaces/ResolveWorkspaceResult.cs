namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public abstract record ResolveWorkspaceResult
{
    private ResolveWorkspaceResult()
    {
    }

    public sealed record Found(WorkspaceResolution Resolution) : ResolveWorkspaceResult;

    public sealed record NotFound : ResolveWorkspaceResult;
}
