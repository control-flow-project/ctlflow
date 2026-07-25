namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record LifecycleOwnerRevision
{
    private LifecycleOwnerRevision(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static ValueTask<LifecycleOwnerRevision> Parse(
        ulong value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (value is 0 or > long.MaxValue)
        {
            throw new ArgumentException(
                "Owner revision must be a positive signed 64-bit value",
                nameof(value));
        }

        return ValueTask.FromResult(new LifecycleOwnerRevision((long)value));
    }

    public static LifecycleOwnerRevision FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException(
                "Stored owner revision must be positive");
        }

        return new LifecycleOwnerRevision(value);
    }
}
