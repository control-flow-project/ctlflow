using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTransitions;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static ValueTask ApplyWorkspaceLifecycleProgress(
        Workspace workspace,
        LifecycleOperationKind operation,
        bool blocked,
        bool complete,
        ResourceEventSequence eventSequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (workspace.CurrentOperationId is null)
        {
            throw new InvalidOperationException(
                "Workspace has no current lifecycle operation");
        }

        if (blocked)
        {
            workspace.Lifecycle = LifecycleState.Failed;
        }
        else if (complete)
        {
            workspace.Lifecycle = GetCompletedLifecycleState(operation);
            workspace.CurrentOperationStorage = null;
        }

        workspace.Revision = workspace.Revision.Next();
        workspace.LastEventSequence = eventSequence;
        workspace.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }
}
