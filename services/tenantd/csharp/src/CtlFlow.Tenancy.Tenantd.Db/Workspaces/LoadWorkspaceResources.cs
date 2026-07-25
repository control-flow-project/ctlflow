using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

internal static partial class WorkspaceResources
{
    internal static IReadOnlyList<WorkspaceResource>
        CreateWorkspaceResources(
            IReadOnlyList<Workspace> workspaces,
            IReadOnlyList<WorkspaceAddressBinding> addresses,
            IReadOnlyList<WorkspaceInitialMembership> memberships,
            IReadOnlyList<WorkspaceBaselinePackage> packages,
            IReadOnlyList<LifecycleOperation> operations,
            IReadOnlyList<LifecycleStep> steps)
    {
        if (workspaces.Count == 0)
        {
            return [];
        }

        return workspaces
            .Select(workspace => CreateWorkspaceResource(
                workspace,
                addresses.Single(value =>
                    value.WorkspaceId == workspace.Id),
                memberships.Where(value =>
                    value.WorkspaceId == workspace.Id.Value),
                packages.Where(value =>
                    value.WorkspaceId == workspace.Id.Value),
                operations.SingleOrDefault(value =>
                    value.Id == workspace.CurrentOperationId),
                steps.Where(value =>
                    value.OperationId == workspace.CurrentOperationId)))
            .ToArray();
    }

    private static WorkspaceResource CreateWorkspaceResource(
        Workspace workspace,
        WorkspaceAddressBinding address,
        IEnumerable<WorkspaceInitialMembership> memberships,
        IEnumerable<WorkspaceBaselinePackage> packages,
        LifecycleOperation? operation,
        IEnumerable<LifecycleStep> steps)
    {
        return new WorkspaceResource(
            workspace.Id,
            workspace.TenantId,
            workspace.DisplayName,
            address.WorkspaceAddress,
            memberships
                .Select(value => new InitialWorkspaceMembershipIntent(
                    UserId.FromStorage(value.UserId),
                    value.Standing switch
                    {
                        1 => MembershipStanding.Admin,
                        2 => MembershipStanding.Member,
                        _ => throw new InvalidOperationException(
                            "Stored membership standing is invalid")
                    }))
                .ToArray(),
            packages
                .Select(value => new BaselinePackageIntent(
                    PackageId.FromStorage(value.PackageId),
                    PackageVersion.FromStorage(value.PackageVersion)))
                .ToArray(),
            workspace.Lifecycle,
            workspace.Revision,
            workspace.ProvisioningGeneration,
            workspace.CurrentOperationId,
            operation?.Kind,
            steps
                .Select(value => new LifecycleCondition(
                    value.Key,
                    value.State,
                    value.BlockedReason,
                    value.OwnerRevision,
                    value.UpdatedAt))
                .ToArray(),
            workspace.LastEventSequence,
            workspace.CreatedAt,
            workspace.UpdatedAt);
    }
}
