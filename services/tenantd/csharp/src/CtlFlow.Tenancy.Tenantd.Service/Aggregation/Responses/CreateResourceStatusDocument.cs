using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Service.Aggregation.Documents;

namespace CtlFlow.Tenancy.Tenantd.Service.Aggregation.Responses;

internal static partial class AggregationResponses
{
    internal static ResourceStatusDocument CreateResourceStatusDocument(
        LifecycleState lifecycle,
        long revision,
        long provisioningGeneration,
        LifecycleOperationId? operationId,
        LifecycleOperationKind? operationKind,
        IReadOnlyList<LifecycleCondition> conditions) =>
        new()
        {
            Lifecycle = MapLifecycle(lifecycle),
            Revision = revision,
            ProvisioningGeneration = provisioningGeneration,
            CurrentOperation = operationId is null || operationKind is null
                ? null
                : new CurrentOperationDocument
                {
                    Id = operationId.Value,
                    Kind = MapOperation(operationKind.Value)
                },
            Conditions = conditions
                .Select(CreateConditionDocument)
                .ToArray()
        };

    private static ConditionDocument CreateConditionDocument(
        LifecycleCondition condition) =>
        new()
        {
            Owner = condition.Step switch
            {
                LifecycleStepKey.Identity => "identity",
                LifecycleStepKey.Configuration => "configuration",
                LifecycleStepKey.Execution => "execution",
                LifecycleStepKey.Packages => "packages",
                _ => throw new InvalidOperationException(
                    "Lifecycle condition owner is invalid")
            },
            State = condition.State switch
            {
                LifecycleStepState.Pending => "pending",
                LifecycleStepState.Blocked => "blocked",
                _ => throw new InvalidOperationException(
                    "Lifecycle condition state is invalid")
            },
            OwnerRevision = condition.OwnerRevision?.Value,
            Reason = condition.Reason?.Value,
            LastTransitionTime = condition.UpdatedAt.Value
        };

    private static string MapLifecycle(LifecycleState lifecycle) =>
        lifecycle switch
        {
            LifecycleState.Provisioning => "provisioning",
            LifecycleState.Active => "active",
            LifecycleState.Suspending => "suspending",
            LifecycleState.Suspended => "suspended",
            LifecycleState.Resuming => "resuming",
            LifecycleState.Deleting => "deleting",
            LifecycleState.Failed => "failed",
            LifecycleState.Deleted => "deleted",
            _ => throw new InvalidOperationException(
                "Lifecycle state is invalid")
        };

    private static string MapOperation(LifecycleOperationKind operation) =>
        operation switch
        {
            LifecycleOperationKind.Provision => "provision",
            LifecycleOperationKind.Suspend => "suspend",
            LifecycleOperationKind.Resume => "resume",
            LifecycleOperationKind.Delete => "delete",
            _ => throw new InvalidOperationException(
                "Lifecycle operation is invalid")
        };
}
