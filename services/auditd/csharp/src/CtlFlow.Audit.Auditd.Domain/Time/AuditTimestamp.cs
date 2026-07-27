namespace CtlFlow.Audit.Auditd.Domain.Time;

public sealed record AuditTimestamp
{
    private const long MinimumSeconds = -62_135_596_800;
    private const long MaximumSeconds = 253_402_300_799;

    private AuditTimestamp(long seconds, int nanoseconds)
    {
        Seconds = seconds;
        Nanoseconds = nanoseconds;
    }

    public long Seconds { get; }

    public int Nanoseconds { get; }

    public static ValueTask<AuditTimestamp> Parse(
        long seconds,
        int nanoseconds,
        CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!IsValid(seconds, nanoseconds))
        {
            throw new ArgumentException("Audit timestamp is invalid");
        }

        return ValueTask.FromResult(
            new AuditTimestamp(seconds, nanoseconds));
    }

    public static AuditTimestamp FromClock(DateTimeOffset value)
    {
        var utc = value.ToUniversalTime();
        return new AuditTimestamp(
            utc.ToUnixTimeSeconds(),
            (int)(utc.Ticks % TimeSpan.TicksPerSecond * 100));
    }

    public static AuditTimestamp FromStorage(long seconds, int nanoseconds)
    {
        if (!IsValid(seconds, nanoseconds))
        {
            throw new InvalidOperationException(
                "Stored audit timestamp is invalid");
        }

        return new AuditTimestamp(seconds, nanoseconds);
    }

    private static bool IsValid(long seconds, int nanoseconds) =>
        seconds is >= MinimumSeconds and <= MaximumSeconds
        && nanoseconds is >= 0 and <= 999_999_999;
}
