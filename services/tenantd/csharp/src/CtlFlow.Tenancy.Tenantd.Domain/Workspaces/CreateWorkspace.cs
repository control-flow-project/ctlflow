using CtlFlow.Tenancy.Tenantd.Domain.Addresses;
using CtlFlow.Tenancy.Tenantd.Domain.Auditing;
using CtlFlow.Tenancy.Tenantd.Domain.Names;
using CtlFlow.Tenancy.Tenantd.Domain.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Tenants;
using static CtlFlow.Tenancy.Tenantd.Domain.Workspaces.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

public static partial class Workspaces
{
    public static async ValueTask<WorkspaceMutationResult> CreateWorkspace(
        WorkspaceId workspaceId,
        TenantId tenantId,
        ResourceAddress address,
        DisplayName displayName,
        ResourceState? parentState,
        WorkspaceDetails? existingById,
        WorkspaceDetails? existingByAddress,
        AuditContext audit,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (existingById is not null)
        {
            return existingById.TenantId == tenantId
                && existingById.Address == address
                && existingById.DisplayName == displayName
                ? new WorkspaceMutationResult.Current(existingById)
                : new WorkspaceMutationResult.AlreadyExists();
        }

        if (existingByAddress is not null)
        {
            return new WorkspaceMutationResult.AlreadyExists();
        }

        if (parentState is null)
        {
            return new WorkspaceMutationResult.NotFound();
        }

        if (parentState != ResourceState.Active)
        {
            return new WorkspaceMutationResult.FailedPrecondition();
        }

        var workspace = new Workspace(
            workspaceId,
            tenantId,
            address,
            displayName,
            ResourceState.Active,
            Revision.Initial(),
            audit.OccurredAt,
            audit.OccurredAt);
        var details = await DescribeWorkspace(workspace, cancellation);
        return new WorkspaceMutationResult.Changed(
            workspace,
            new AuditIntent(
                AuditEventId.Generate(),
                AuditOperation.CreateWorkspace,
                audit.Attribution,
                new AuditTarget.Workspace(tenantId, workspaceId),
                details.State,
                details.Revision,
                audit.Correlation,
                audit.OccurredAt));
    }
}
