using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Db.Resources;

internal static partial class ResourceEvents
{
    private static void AddResourceEventConditions(
        TenantDbContext database,
        long eventSequence,
        IReadOnlyList<LifecycleStep> currentSteps)
    {
        foreach (var step in currentSteps.Where(
                     value => value.State != LifecycleStepState.Complete))
        {
            database.ResourceEventConditions.Add(
                new ResourceEventCondition(
                    eventSequence,
                    (int)step.Key,
                    (int)step.State,
                    step.OwnerRevision?.Value,
                    step.BlockedReason?.Value,
                    step.UpdatedAt.UnixMilliseconds));
        }
    }
}
