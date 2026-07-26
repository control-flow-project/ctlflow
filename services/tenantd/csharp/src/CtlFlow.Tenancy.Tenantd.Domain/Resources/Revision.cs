namespace CtlFlow.Tenancy.Tenantd.Domain.Resources;

public sealed record Revision
{
    private Revision(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static Revision Initial() => new(1);

    public static ValueTask<Revision> Parse(
        ulong value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (value is 0 or > long.MaxValue)
        {
            throw new ArgumentException(
                "Revision must be a positive signed 64-bit value",
                nameof(value));
        }

        return ValueTask.FromResult(new Revision((long)value));
    }

    public static Revision FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException("Stored revision must be positive");
        }

        return new Revision(value);
    }

    public Revision Next() => new(checked(Value + 1));
}
