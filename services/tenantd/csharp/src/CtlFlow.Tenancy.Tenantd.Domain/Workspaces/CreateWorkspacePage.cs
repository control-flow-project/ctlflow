using CtlFlow.Tenancy.Tenantd.Domain.Collections;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static ValueTask<WorkspacePage> CreateWorkspacePage(
        IReadOnlyList<WorkspaceDetails> candidates,
        PageSize pageSize,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (candidates.Count > pageSize.Value + 1)
        {
            throw new InvalidOperationException(
                "Workspace page candidate set is not bounded");
        }

        var hasNext = candidates.Count > pageSize.Value;
        var workspaces = hasNext
            ? candidates.Take(pageSize.Value).ToArray()
            : candidates.ToArray();
        return ValueTask.FromResult(new WorkspacePage(
            workspaces,
            hasNext ? workspaces[^1].WorkspaceId : null));
    }
}
