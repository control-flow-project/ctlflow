namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public abstract record WorkspaceLookupResult
{
    private WorkspaceLookupResult()
    {
    }

    public sealed record Found(
        WorkspaceDetails Workspace) : WorkspaceLookupResult;

    public sealed record NotFound : WorkspaceLookupResult;
}
