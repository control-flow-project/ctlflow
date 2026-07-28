namespace CtlFlow.Configuration.Configd.Domain.Time;

public sealed record UtcInstant
{
    private UtcInstant(long unixMilliseconds) =>
        UnixMilliseconds = unixMilliseconds;

    public long UnixMilliseconds { get; }

    public DateTimeOffset Value =>
        DateTimeOffset.FromUnixTimeMilliseconds(UnixMilliseconds);

    public static UtcInstant FromClock(DateTimeOffset value)
    {
        var milliseconds = value.ToUnixTimeMilliseconds();
        return milliseconds > 0
            ? new UtcInstant(milliseconds)
            : throw new ArgumentException(
                "Timestamp must follow the Unix epoch",
                nameof(value));
    }

    public static UtcInstant FromStorage(long value) =>
        value > 0
            ? new UtcInstant(value)
            : throw new InvalidOperationException(
                "Stored timestamp must follow the Unix epoch");
}
