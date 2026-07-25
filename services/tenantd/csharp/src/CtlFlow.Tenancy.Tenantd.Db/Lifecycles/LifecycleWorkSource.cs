using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Sequences;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal sealed record LifecycleWorkSource(
    LifecycleOperationId OperationId,
    LifecycleDeliverySequence DeliverySequence,
    LifecycleStepKey StepKey,
    LifecycleStepState StepState,
    LifecycleStepRevision StepRevision,
    BlockedReason? BlockedReason);
