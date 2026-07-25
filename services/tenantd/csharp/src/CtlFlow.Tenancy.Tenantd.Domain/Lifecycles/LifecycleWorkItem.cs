using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record LifecycleWorkItem(
    LifecycleDeliverySequence DeliverySequence,
    LifecycleTarget Target,
    LifecycleOperationId OperationId,
    long ProvisioningGeneration,
    LifecycleOperationKind Operation,
    LifecycleState DesiredLifecycle,
    LifecycleStepKey StepKey,
    LifecycleStepState StepState,
    LifecycleStepRevision StepRevision,
    BlockedReason? BlockedReason,
    LifecycleProvisioningIntent ProvisioningIntent);
