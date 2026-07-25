using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.V1;
using Grpc.Core;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Responses;

internal static partial class LifecycleResponses
{
    internal static ValueTask<AcknowledgeLifecycleStepResponse>
        CreateAcknowledgeLifecycleStepResponse(
            LifecycleAcknowledgementResult result,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (result is LifecycleAcknowledgementResult.Accepted accepted)
        {
            return ValueTask.FromResult(
                new AcknowledgeLifecycleStepResponse
                {
                    StepState = MapLifecycleStepState(
                        accepted.Value.StepState),
                    StepRevision = checked(
                        (ulong)accepted.Value.StepRevision.Value),
                    Lifecycle = MapLifecycleState(
                        accepted.Value.Lifecycle),
                    ResourceRevision = checked(
                        (ulong)accepted.Value.ResourceRevision),
                    ProvisioningGeneration = checked(
                        (ulong)accepted.Value.ProvisioningGeneration)
                });
        }

        throw result switch
        {
            LifecycleAcknowledgementResult.NotFound =>
                Failure(StatusCode.NotFound, "Lifecycle step was not found"),
            LifecycleAcknowledgementResult.StaleOperation =>
                Failure(
                    StatusCode.FailedPrecondition,
                    "Lifecycle operation is stale"),
            LifecycleAcknowledgementResult.StepNotPending =>
                Failure(
                    StatusCode.FailedPrecondition,
                    "Lifecycle step is not pending"),
            LifecycleAcknowledgementResult.IdempotencyConflict =>
                Failure(
                    StatusCode.AlreadyExists,
                    "Idempotency key was reused with another request"),
            LifecycleAcknowledgementResult.RevisionConflict =>
                Failure(
                    StatusCode.Aborted,
                    "Lifecycle step revision does not match"),
            _ => new InvalidOperationException(
                "Lifecycle acknowledgement result is invalid")
        };
    }

    private static RpcException Failure(
        StatusCode code,
        string detail) =>
        new(new Status(code, detail));
}
