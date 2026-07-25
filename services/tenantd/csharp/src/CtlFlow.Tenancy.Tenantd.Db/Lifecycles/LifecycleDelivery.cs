using CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

namespace CtlFlow.Tenancy.Tenantd.Db.Lifecycles;

public class LifecycleDelivery
{
    private LifecycleDelivery()
    {
    }

    internal LifecycleDelivery(
        long deliverySequence,
        string operationId,
        LifecycleStepKey stepKey,
        long stepRevision,
        long createdAtUnixMilliseconds)
    {
        DeliverySequence = deliverySequence;
        OperationId = operationId;
        StepKey = stepKey;
        StepRevision = stepRevision;
        CreatedAtUnixMilliseconds = createdAtUnixMilliseconds;
    }

    public long DeliverySequence { get; private set; }

    public string OperationId { get; private set; } = string.Empty;

    public LifecycleStepKey StepKey { get; private set; }

    public long StepRevision { get; private set; }

    public long CreatedAtUnixMilliseconds { get; private set; }

    public LifecycleOperation Operation { get; private set; } = null!;

    public LifecycleStep Step { get; private set; } = null!;
}
