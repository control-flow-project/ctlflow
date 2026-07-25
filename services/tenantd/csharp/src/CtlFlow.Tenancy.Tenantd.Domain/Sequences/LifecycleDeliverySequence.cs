namespace CtlFlow.Tenancy.Tenantd.Domain.Sequences;

public sealed record LifecycleDeliverySequence
{
    private LifecycleDeliverySequence(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static LifecycleDeliverySequence FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException(
                "Stored lifecycle delivery sequence must be positive");
        }

        return new LifecycleDeliverySequence(value);
    }
}
