namespace CtlFlow.Tenancy.Tenantd.Domain.Sequences;

public sealed record ResourceEventCursor
{
    private ResourceEventCursor(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static ResourceEventCursor Parse(long value)
    {
        if (value < 0)
        {
            throw new ArgumentOutOfRangeException(nameof(value));
        }

        return new ResourceEventCursor(value);
    }

    public static ResourceEventCursor FromStorage(long value)
    {
        if (value < 0)
        {
            throw new InvalidOperationException(
                "Stored resource event cursor cannot be negative");
        }

        return new ResourceEventCursor(value);
    }
}
