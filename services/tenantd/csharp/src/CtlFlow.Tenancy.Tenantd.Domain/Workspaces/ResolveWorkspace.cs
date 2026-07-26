using CtlFlow.Tenancy.Tenantd.Domain.Resources;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static ValueTask<WorkspaceResolutionResult> ResolveWorkspace(
        WorkspaceDetails? candidate,
        ResourceState? parentState,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        return ValueTask.FromResult<WorkspaceResolutionResult>(
            candidate is { State: ResourceState.Active }
                && parentState == ResourceState.Active
                ? new WorkspaceResolutionResult.Found(
                    candidate.WorkspaceId,
                    candidate.State,
                    candidate.Revision)
                : new WorkspaceResolutionResult.NotFound());
    }
}
