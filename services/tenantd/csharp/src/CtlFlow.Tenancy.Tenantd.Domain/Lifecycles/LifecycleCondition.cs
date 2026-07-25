using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record LifecycleCondition(
    LifecycleStepKey Step,
    LifecycleStepState State,
    BlockedReason? Reason,
    LifecycleOwnerRevision? OwnerRevision,
    UtcInstant UpdatedAt);
