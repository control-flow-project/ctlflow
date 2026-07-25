using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTransitions;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static ValueTask RetryWorkspaceLifecycle(
        Workspace workspace,
        LifecycleOperationKind operation,
        LifecycleOperationId operationId,
        ResourceEventSequence eventSequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (workspace.Lifecycle != LifecycleState.Failed
            || workspace.CurrentOperationId != operationId)
        {
            throw new InvalidOperationException(
                "Workspace has no matching failed lifecycle operation");
        }

        workspace.Lifecycle = GetTransitionalLifecycleState(operation);
        workspace.Revision = workspace.Revision.Next();
        workspace.LastEventSequence = eventSequence;
        workspace.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }
}
