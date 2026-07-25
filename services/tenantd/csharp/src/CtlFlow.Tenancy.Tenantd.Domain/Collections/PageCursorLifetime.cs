namespace CtlFlow.Tenancy.Tenantd.Domain.Collections;

public readonly record struct PageCursorLifetime
{
    private const int MaximumSeconds = 600;

    private PageCursorLifetime(TimeSpan value)
    {
        Value = value;
    }

    public TimeSpan Value { get; }

    public static ValueTask<PageCursorLifetime> Parse(
        int seconds,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (seconds is < 1 or > MaximumSeconds)
        {
            throw new ArgumentOutOfRangeException(
                nameof(seconds),
                "Page cursor lifetime must be between one and 600 seconds");
        }

        return ValueTask.FromResult(
            new PageCursorLifetime(TimeSpan.FromSeconds(seconds)));
    }
}
