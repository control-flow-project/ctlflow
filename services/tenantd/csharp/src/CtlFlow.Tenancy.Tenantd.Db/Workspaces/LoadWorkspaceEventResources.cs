using CtlFlow.Tenancy.Tenantd.Db.Provisioning;
using CtlFlow.Tenancy.Tenantd.Db.Resources;
using CtlFlow.Tenancy.Tenantd.Domain.Collections;
using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Provisioning;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using CtlFlow.Tenancy.Tenantd.Domain.Workspaces;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleStates;

namespace CtlFlow.Tenancy.Tenantd.Db.Workspaces;

internal static partial class WorkspaceResources
{
    internal static IReadOnlyList<ResourceWatchEvent<WorkspaceResource>>
        CreateWorkspaceEventResources(
            IReadOnlyList<ResourceEvent> events,
            IReadOnlyList<Workspace> workspaces,
            IReadOnlyList<WorkspaceAddressBinding> addresses,
            IReadOnlyList<WorkspaceInitialMembership> memberships,
            IReadOnlyList<WorkspaceBaselinePackage> packages,
            IReadOnlyList<LifecycleOperation> operations,
            IReadOnlyList<ResourceEventCondition> conditions)
    {
        if (events.Count == 0)
        {
            return [];
        }

        return events
            .Select(resourceEvent =>
            {
                var workspace = workspaces.Single(value =>
                    value.Id.Value == resourceEvent.WorkspaceId);
                var operation = resourceEvent.CurrentOperationId is null
                    ? null
                    : operations.Single(value =>
                        value.Id.Value
                        == resourceEvent.CurrentOperationId);
                var eventConditions = conditions
                    .Where(value =>
                        value.EventSequence
                        == resourceEvent.EventSequence)
                    .Select(CreateEventCondition)
                    .ToArray();
                if (resourceEvent.CurrentOperationId is not null
                    && eventConditions.Length == 0)
                {
                    throw new InvalidOperationException(
                        "A Workspace event with a current lifecycle operation "
                        + "has no condition snapshot");
                }

                var resource = new WorkspaceResource(
                    workspace.Id,
                    workspace.TenantId,
                    WorkspaceDisplayName.FromStorage(
                        resourceEvent.DisplayName),
                    addresses.Single(value =>
                        value.WorkspaceId == workspace.Id).WorkspaceAddress,
                    memberships
                        .Where(value =>
                            value.WorkspaceId == workspace.Id.Value)
                        .Select(CreateEventMembership)
                        .ToArray(),
                    packages
                        .Where(value =>
                            value.WorkspaceId == workspace.Id.Value)
                        .Select(CreateEventPackage)
                        .ToArray(),
                    FromStorage(resourceEvent.LifecycleState),
                    WorkspaceRevision.FromStorage(
                        resourceEvent.ResourceRevision),
                    WorkspaceProvisioningGeneration.FromStorage(
                        resourceEvent.ProvisioningGeneration),
                    operation?.Id,
                    operation?.Kind,
                    eventConditions,
                    ResourceEventSequence.FromStorage(
                        resourceEvent.EventSequence),
                    workspace.CreatedAt,
                    UtcInstant.FromStorage(
                        resourceEvent.EventAtUnixMilliseconds));
                return new ResourceWatchEvent<WorkspaceResource>(
                    ResourceEventSequence.FromStorage(
                        resourceEvent.EventSequence),
                    (ResourceEventKind)resourceEvent.EventKind,
                    resource);
            })
            .ToArray();
    }

    private static InitialWorkspaceMembershipIntent CreateEventMembership(
        WorkspaceInitialMembership value) =>
        new(
            UserId.FromStorage(value.UserId),
            value.Standing switch
            {
                1 => MembershipStanding.Admin,
                2 => MembershipStanding.Member,
                _ => throw new InvalidOperationException(
                    "Stored membership standing is invalid")
            });

    private static BaselinePackageIntent CreateEventPackage(
        WorkspaceBaselinePackage value) =>
        new(
            PackageId.FromStorage(value.PackageId),
            PackageVersion.FromStorage(value.PackageVersion));

    private static LifecycleCondition CreateEventCondition(
        ResourceEventCondition value) =>
        new(
            (LifecycleStepKey)value.StepKey,
            (LifecycleStepState)value.StepState,
            value.BlockedReason is null
                ? null
                : BlockedReason.FromStorage(value.BlockedReason),
            value.OwnerRevision is null
                ? null
                : LifecycleOwnerRevision.FromStorage(
                    value.OwnerRevision.Value),
            UtcInstant.FromStorage(value.UpdatedAtUnixMilliseconds));
}
