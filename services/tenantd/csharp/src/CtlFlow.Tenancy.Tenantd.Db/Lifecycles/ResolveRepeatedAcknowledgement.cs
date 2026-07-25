using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using static CtlFlow.Tenancy.Tenantd.Domain.Lifecycles.LifecycleStates;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

public static partial class Lifecycles
{
    private static LifecycleAcknowledgementResult
        ResolveRepeatedAcknowledgement(
            Requests.IdempotencyRecord repeated,
            AcknowledgeLifecycleCommand command)
    {
        if (repeated.RequestHash != command.RequestDigest.Value
            || repeated.LifecycleOperationId != command.OperationId.Value
            || repeated.ResultStepRevision is null
            || repeated.ResultStepState is null)
        {
            return new LifecycleAcknowledgementResult.IdempotencyConflict();
        }

        return new LifecycleAcknowledgementResult.Accepted(
            new LifecycleAcknowledgement(
                (LifecycleStepState)repeated.ResultStepState.Value,
                LifecycleStepRevision.FromStorage(
                    repeated.ResultStepRevision.Value),
                FromStorage(repeated.ResultLifecycleState),
                repeated.ResultResourceRevision,
                repeated.ResultProvisioningGeneration));
    }
}
