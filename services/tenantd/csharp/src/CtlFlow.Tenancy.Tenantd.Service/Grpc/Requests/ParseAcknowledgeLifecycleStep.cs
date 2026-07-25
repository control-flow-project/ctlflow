using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Requests;
using Google.Protobuf;
using WireLifecycleStepKey = CtlFlow.Tenancy.V1.LifecycleStepKey;
using WireLifecycleStepOutcome = CtlFlow.Tenancy.V1.LifecycleStepOutcome;
using WireRequest = CtlFlow.Tenancy.V1.AcknowledgeLifecycleStepRequest;

namespace CtlFlow.Tenancy.Tenantd.Service.Grpc.Requests;

internal static partial class LifecycleRequests
{
    internal static async ValueTask<AcknowledgeLifecycleCommand>
        ParseAcknowledgeLifecycleStep(
            WireRequest request,
            RequestActor actor,
            CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var target = await ParseLifecycleTarget(
            request.Target,
            cancellation);
        var operationId = await LifecycleOperationId.Parse(
            request.LifecycleOperationId,
            cancellation);
        var generation = ParseGeneration(request.ProvisioningGeneration);
        var stepKey = ParseStepKey(request.StepKey);
        var expectedStepRevision = await LifecycleStepRevision.Parse(
            request.ExpectedStepRevision,
            cancellation);
        var ownerRevision = await LifecycleOwnerRevision.Parse(
            request.OwnerRevision,
            cancellation);
        var outcome = ParseOutcome(request.Outcome);
        var blockedReason = request.HasBlockedReason
            ? await BlockedReason.Parse(
                request.BlockedReason,
                cancellation)
            : null;
        ValidateBlockedReason(outcome, blockedReason);
        var idempotencyKey = await IdempotencyKey.Parse(
            request.IdempotencyKey,
            cancellation);
        var digest = RequestDigest.Calculate(
            Convert.ToHexString(request.ToByteArray()));

        return new AcknowledgeLifecycleCommand(
            target,
            operationId,
            generation,
            stepKey,
            expectedStepRevision,
            ownerRevision,
            outcome,
            blockedReason,
            actor,
            idempotencyKey,
            digest);
    }

    private static long ParseGeneration(ulong generation)
    {
        if (generation is 0 or > long.MaxValue)
        {
            throw new ArgumentException(
                "Provisioning generation must be a positive signed 64-bit value",
                nameof(generation));
        }

        return (long)generation;
    }

    private static LifecycleStepKey ParseStepKey(
        WireLifecycleStepKey stepKey) =>
        stepKey switch
        {
            WireLifecycleStepKey.Identity => LifecycleStepKey.Identity,
            WireLifecycleStepKey.Configuration =>
                LifecycleStepKey.Configuration,
            WireLifecycleStepKey.Execution => LifecycleStepKey.Execution,
            WireLifecycleStepKey.Packages => LifecycleStepKey.Packages,
            _ => throw new ArgumentException(
                "Lifecycle step key is required",
                nameof(stepKey))
        };

    private static LifecycleStepOutcome ParseOutcome(
        WireLifecycleStepOutcome outcome) =>
        outcome switch
        {
            WireLifecycleStepOutcome.Complete =>
                LifecycleStepOutcome.Complete,
            WireLifecycleStepOutcome.Blocked =>
                LifecycleStepOutcome.Blocked,
            _ => throw new ArgumentException(
                "Lifecycle step outcome is required",
                nameof(outcome))
        };

    private static void ValidateBlockedReason(
        LifecycleStepOutcome outcome,
        BlockedReason? blockedReason)
    {
        if (outcome == LifecycleStepOutcome.Blocked
            && blockedReason is null)
        {
            throw new ArgumentException(
                "A blocked acknowledgement requires a reason");
        }

        if (outcome == LifecycleStepOutcome.Complete
            && blockedReason is not null)
        {
            throw new ArgumentException(
                "A complete acknowledgement cannot contain a reason");
        }
    }
}
