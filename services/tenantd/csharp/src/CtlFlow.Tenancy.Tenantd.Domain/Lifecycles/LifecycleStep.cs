using CtlFlow.Tenancy.Tenantd.Domain.Sequences;
using CtlFlow.Tenancy.Tenantd.Domain.Time;

namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public class LifecycleStep
{
    private string _operationId = string.Empty;
    private long _deliverySequence;

    private LifecycleStep()
    {
    }

    internal LifecycleStep(
        LifecycleOperationId operationId,
        LifecycleStepKey key,
        LifecycleDeliverySequence deliverySequence,
        UtcInstant now)
    {
        _operationId = operationId.Value;
        Key = key;
        State = LifecycleStepState.Pending;
        Revision = LifecycleStepRevision.FromStorage(1);
        _deliverySequence = deliverySequence.Value;
        UpdatedAt = now;
    }

    internal LifecycleStep(
        LifecycleOperationId operationId,
        LifecycleStepKey key,
        LifecycleStepState state,
        LifecycleStepRevision revision,
        LifecycleDeliverySequence deliverySequence,
        LifecycleOwnerRevision? ownerRevision,
        BlockedReason? blockedReason,
        UtcInstant updatedAt)
    {
        _operationId = operationId.Value;
        Key = key;
        State = state;
        Revision = revision;
        _deliverySequence = deliverySequence.Value;
        OwnerRevision = ownerRevision;
        BlockedReason = blockedReason;
        UpdatedAt = updatedAt;
    }

    public LifecycleOperationId OperationId =>
        LifecycleOperationId.FromStorage(_operationId);

    public LifecycleStepKey Key { get; private set; }

    public LifecycleStepState State { get; internal set; }

    public LifecycleStepRevision Revision { get; internal set; } = null!;

    public LifecycleDeliverySequence DeliverySequence =>
        LifecycleDeliverySequence.FromStorage(_deliverySequence);

    internal long DeliverySequenceStorage
    {
        get => _deliverySequence;
        set => _deliverySequence = value;
    }

    public LifecycleOwnerRevision? OwnerRevision { get; internal set; }

    public BlockedReason? BlockedReason { get; internal set; }

    public UtcInstant UpdatedAt { get; internal set; } = null!;
}
