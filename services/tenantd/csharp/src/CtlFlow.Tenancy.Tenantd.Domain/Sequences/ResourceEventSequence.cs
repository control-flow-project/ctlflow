namespace CtlFlow.Tenancy.Tenantd.Domain.Sequences;

public sealed record ResourceEventSequence
{
    private ResourceEventSequence(long value)
    {
        Value = value;
    }

    public long Value { get; }

    public static ValueTask<ResourceEventSequence> Parse(
        string value,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!long.TryParse(
                value,
                System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture,
                out var parsed)
            || parsed <= 0)
        {
            throw new ArgumentException(
                "Resource version must be a positive signed 64-bit integer",
                nameof(value));
        }

        return ValueTask.FromResult(new ResourceEventSequence(parsed));
    }

    public static ResourceEventSequence FromStorage(long value)
    {
        if (value <= 0)
        {
            throw new InvalidOperationException(
                "Stored resource event sequence must be positive");
        }

        return new ResourceEventSequence(value);
    }
}
