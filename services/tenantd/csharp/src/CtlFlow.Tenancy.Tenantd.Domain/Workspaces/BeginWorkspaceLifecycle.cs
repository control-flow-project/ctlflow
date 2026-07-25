using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTransitions;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static ValueTask BeginWorkspaceLifecycle(
        Workspace workspace,
        LifecycleOperationKind operation,
        LifecycleOperationId operationId,
        ResourceEventSequence eventSequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        ValidateCurrentState(workspace.Lifecycle, operation);

        workspace.Lifecycle = GetTransitionalLifecycleState(operation);
        workspace.ProvisioningGeneration =
            workspace.ProvisioningGeneration.Next();
        workspace.Revision = workspace.Revision.Next();
        workspace.CurrentOperationStorage = operationId.Value;
        workspace.LastEventSequence = eventSequence;
        workspace.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }

    private static void ValidateCurrentState(
        LifecycleState state,
        LifecycleOperationKind operation)
    {
        var valid = operation switch
        {
            LifecycleOperationKind.Suspend =>
                state == LifecycleState.Active,
            LifecycleOperationKind.Resume =>
                state == LifecycleState.Suspended,
            LifecycleOperationKind.Delete =>
                state is LifecycleState.Active
                    or LifecycleState.Suspended
                    or LifecycleState.Failed,
            _ => false
        };

        if (!valid)
        {
            throw new InvalidOperationException(
                "Workspace lifecycle transition is not admitted");
        }
    }
}
