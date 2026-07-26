using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static async ValueTask<WorkspaceMutationResult>
        UpdateWorkspaceDisplayName(
            Workspace workspace,
            Revision expectedRevision,
            DisplayName displayName,
            AuditContext audit,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (workspace.Revision != expectedRevision)
        {
            return new WorkspaceMutationResult.RevisionMismatch();
        }

        if (workspace.State == ResourceState.Deleted)
        {
            return new WorkspaceMutationResult.FailedPrecondition();
        }

        if (workspace.DisplayName == displayName)
        {
            return new WorkspaceMutationResult.Current(
                await DescribeWorkspace(workspace, cancellation));
        }

        workspace.ChangeDisplayName(displayName, audit.OccurredAt);
        var details = await DescribeWorkspace(workspace, cancellation);
        return new WorkspaceMutationResult.Changed(
            workspace,
            new AuditIntent(
                AuditEventId.Generate(),
                AuditOperation.UpdateWorkspace,
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
