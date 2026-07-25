using CtlFlow.Tenancy.Tenantd.Domain.Requests;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record AcknowledgeLifecycleCommand(
    LifecycleTarget Target,
    LifecycleOperationId OperationId,
    long ProvisioningGeneration,
    LifecycleStepKey StepKey,
    LifecycleStepRevision ExpectedStepRevision,
    LifecycleOwnerRevision OwnerRevision,
    LifecycleStepOutcome Outcome,
    BlockedReason? BlockedReason,
    RequestActor Actor,
    IdempotencyKey IdempotencyKey,
    RequestDigest RequestDigest);
