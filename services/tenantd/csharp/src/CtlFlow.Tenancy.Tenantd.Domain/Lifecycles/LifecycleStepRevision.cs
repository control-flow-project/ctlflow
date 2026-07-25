namespace CtlFlow.Tenancy.Tenantd.Domain.Lifecycles;

public sealed record LifecycleStepRevision
{
    private LifecycleStepRevision(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static ValueTask<LifecycleStepRevision> Parse(
        ulong value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (value is 0 or > long.MaxValue)
        {
            throw new ArgumentException(
                "Lifecycle step revision must be a positive signed 64-bit value",
                nameof(value));
        }

        return ValueTask.FromResult(
            new LifecycleStepRevision((long)value));
    }

    public static LifecycleStepRevision FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException(
                "Stored lifecycle step revision must be positive");
        }

        return new LifecycleStepRevision(value);
    }
}
