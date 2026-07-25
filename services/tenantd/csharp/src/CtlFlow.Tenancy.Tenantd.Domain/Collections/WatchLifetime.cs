namespace CtlFlow.Tenancy.Tenantd.Domain.Collections;

public readonly record struct WatchLifetime
{
    private const int MaximumSeconds = 300;

    private WatchLifetime(TimeSpan value)
    {
        Value = value;
    }

    public TimeSpan Value { get; }

    public static ValueTask<WatchLifetime> Parse(
        int seconds,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (seconds is < 1 or > MaximumSeconds)
        {
            throw new ArgumentOutOfRangeException(
                nameof(seconds),
                "Watch lifetime must be between one and 300 seconds");
        }

        return ValueTask.FromResult(
            new WatchLifetime(TimeSpan.FromSeconds(seconds)));
    }
}
