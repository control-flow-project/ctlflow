using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleTransitions;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static ValueTask UpdateWorkspaceDisplayName(
        Workspace workspace,
        WorkspaceDisplayName displayName,
        ResourceEventSequence eventSequence,
        UtcInstant now,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!IsDisplayMetadataUpdateAdmitted(workspace.Lifecycle))
        {
            throw new InvalidOperationException(
                "Workspace lifecycle does not admit display-name updates");
        }

        workspace.DisplayName = displayName;
        workspace.Revision = workspace.Revision.Next();
        workspace.LastEventSequence = eventSequence;
        workspace.UpdatedAt = now;
        return ValueTask.CompletedTask;
    }
}
