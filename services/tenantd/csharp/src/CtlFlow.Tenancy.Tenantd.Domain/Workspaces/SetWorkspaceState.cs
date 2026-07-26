using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static async ValueTask<WorkspaceMutationResult> SetWorkspaceState(
        Workspace workspace,
        Revision expectedRevision,
        ResourceState desiredState,
        ResourceState? parentState,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (workspace.Revision != expectedRevision)
        {
            return new WorkspaceMutationResult.RevisionMismatch();
        }

        if (!Enum.IsDefined(desiredState))
        {
            throw new ArgumentException(
                "Workspace state is invalid",
                nameof(desiredState));
        }

        if (workspace.State == desiredState)
        {
            return new WorkspaceMutationResult.Current(
                await DescribeWorkspace(workspace, cancellation));
        }

        if (desiredState == ResourceState.Active
            && parentState != ResourceState.Active)
        {
            return new WorkspaceMutationResult.FailedPrecondition();
        }

        if (workspace.State == ResourceState.Deleted)
        {
            return new WorkspaceMutationResult.FailedPrecondition();
        }

        workspace.ChangeState(desiredState, audit.OccurredAt);
        var details = await DescribeWorkspace(workspace, cancellation);
        return new WorkspaceMutationResult.Changed(
            workspace,
            new AuditIntent(
                AuditEventId.Generate(),
                AuditOperation.SetWorkspaceState,
                audit.Attribution,
                new AuditTarget.Workspace(
                    workspace.TenantId,
                    workspace.Id),
                details.State,
                details.Revision,
                audit.Correlation,
                audit.OccurredAt));
    }
}
