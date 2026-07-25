namespace CtlFlow.Tenancy.Tenantd.Domain.Sequences;

public sealed record LifecycleDeliveryCursor
{
    private LifecycleDeliveryCursor(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static LifecycleDeliveryCursor Parse(long value)
    {
        if (value < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(value));
        }

        return new LifecycleDeliveryCursor(value);
    }

    public static LifecycleDeliveryCursor FromStorage(long value)
    {
        if (value < 0)
        {
            throw new InvalidOperationException(
                "Stored lifecycle delivery cursor cannot be negative");
        }

        return new LifecycleDeliveryCursor(value);
    }
}
