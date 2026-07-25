using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleOperations;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal static partial class LifecycleWork
{
    private static readonly LifecycleStepKey[] RequiredSteps =
    [
        LifecycleStepKey.Identity,
        LifecycleStepKey.Configuration,
        LifecycleStepKey.Execution,
        LifecycleStepKey.Packages
    ];

    internal static async Task<IReadOnlyList<LifecycleStep>>
        AddLifecycleSteps(
            TenantDbContext database,
            LifecycleOperationId operationId,
            IReadOnlyList<LifecycleDeliverySequence> deliverySequences,
            UtcInstant now,
            CancellationToken cancellation)
    {
        if (deliverySequences.Count != RequiredSteps.Length)
        {
            throw new ArgumentException(
                "Every lifecycle operation requires four delivery sequences",
                nameof(deliverySequences));
        }

        var steps = new LifecycleStep[RequiredSteps.Length];
        for (var index = 0; index < RequiredSteps.Length; index++)
        {
            var step = await CreateLifecycleStep(
                operationId,
                RequiredSteps[index],
                deliverySequences[index],
                now,
                cancellation);
            steps[index] = step;
            database.LifecycleSteps.Add(step);
            database.LifecycleDeliveries.Add(new LifecycleDelivery(
                step.DeliverySequence.Value,
                operationId.Value,
                step.Key,
                step.Revision.Value,
                now.UnixMilliseconds));
        }

        return steps;
    }
}
