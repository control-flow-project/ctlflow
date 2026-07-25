using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;
using CtlFlow.Tenancy.Tenantd.Domain.Time;
namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

internal sealed record LifecycleStepRow(
    string OperationId,
    LifecycleStepKey Key,
    LifecycleStepState State,
    LifecycleStepRevision Revision,
    long DeliverySequence,
    LifecycleOwnerRevision? OwnerRevision,
    BlockedReason? BlockedReason,
    UtcInstant UpdatedAt);
