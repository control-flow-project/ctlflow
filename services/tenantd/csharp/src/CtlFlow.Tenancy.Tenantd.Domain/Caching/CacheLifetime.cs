namespace CtlFlow.Tenancy.Tenantd.Domain.Caching;

public readonly record struct CacheLifetime
{
    private static readonly TimeSpan Minimum = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan Maximum = TimeSpan.FromSeconds(60);

    private CacheLifetime(TimeSpan value)
    {
        Value = value;
    }

    public TimeSpan Value { get; }

    public static ValueTask<CacheLifetime> Parse(
        int seconds,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        var value = TimeSpan.FromSeconds(seconds);

        if (value < Minimum || value > Maximum)
        {
            throw new ArgumentOutOfRangeException(
                nameof(seconds),
                "Cache lifetime must be between one and 60 seconds");
        }

        return ValueTask.FromResult(new CacheLifetime(value));
    }
}
