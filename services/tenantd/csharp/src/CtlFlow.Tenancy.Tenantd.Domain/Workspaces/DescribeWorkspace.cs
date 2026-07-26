namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static ValueTask<WorkspaceDetails> DescribeWorkspace(
        Workspace workspace,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult(new WorkspaceDetails(
            workspace.Id,
            workspace.TenantId,
            workspace.Address,
            workspace.DisplayName,
            workspace.State,
            workspace.Revision,
            workspace.CreatedAt,
            workspace.UpdatedAt));
    }
}
